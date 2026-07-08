import { join } from 'path';

import { Config, ProfileConfig, profileConfigSchema, providerNameSchema, ProviderName } from '../utils/config';
import type { promises as fs } from 'fs';
import { isString } from '../utils/typeguards';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { shake } from 'radash';
import { Inject, Injectable, Optional } from '../utils/inversify';
import { type Environment } from '../utils/env';
import { resolveApiKey, getApiKeySourceEnvVar } from '../utils/resolve-api-key';

export const CLI_ARGUMENTS = Symbol.for('CLI_ARGUMENTS');
export const CONFIG_FILE_PATH = Symbol.for('CONFIG_FILE_PATH');
export const FILE_SYSTEM_PROMISE_API = Symbol.for('FILE_SYSTEM_PROMISE_API');
export const ENVIRONMENT_VARIABLES = Symbol.for('ENVIRONMENT_VARIABLES');

export type FileSystemApi = Pick<typeof fs, 'writeFile' | 'readFile'>;
/**
 * Raw, unvalidated values as they arrive from the CLI parser. `locale` and `type`
 * are intentionally plain strings here (not the narrower `ProfileConfig` unions)
 * because Commander cannot guarantee they're valid; `profileConfigSchema` performs
 * the actual validation once these are merged into the profile config.
 */
export type CliArguments = {
    profile?: string;
    apiKey?: string;
    baseUrl?: string;
    contextLines?: number;
    exclude?: string[];
    locale?: string;
    maxLength?: number;
    model?: string;
    stageAll?: boolean;
    type?: string;
};
type ConfigValidationResult = { valid: true } | { valid: false; errors: unknown[] };

interface ConfigState {
    profiles: Record<string, Partial<ProfileConfig>>;
    currentProfile: string;
    globalIgnore?: string[];
}

@Injectable()
export class ConfigService {
    private readonly configFilePath: string;
    private inMemoryConfig: Partial<ConfigState> = {};

    constructor(
        @Inject(CLI_ARGUMENTS) private readonly cliArguments: CliArguments,
        @Optional() @Inject(CONFIG_FILE_PATH) configFilePath: string | undefined,
        @Inject(FILE_SYSTEM_PROMISE_API) private readonly fs: FileSystemApi,
        @Inject(ENVIRONMENT_VARIABLES) private readonly env: Environment,
    ) {
        this.configFilePath = configFilePath ?? join(this.env.HOME || this.env.USERPROFILE || '.', '.aicommits.yaml');
    }

    public getConfigFilePath(): string {
        return this.configFilePath;
    }

    async readConfig(): Promise<void> {
        try {
            const fileContents = await this.fs.readFile(this.configFilePath, 'utf8');
            const parsed = yamlParse(fileContents);
            this.inMemoryConfig = this.migrateLegacyConfig(parsed);
        } catch {
            this.inMemoryConfig = this.getDefaultConfig();
        }
    }

    private migrateLegacyConfig(parsed: unknown): ConfigState {
        // First, try to parse as a single profile config (legacy format)
        const potentialProfileConfig = profileConfigSchema.safeParse(parsed);
        if (potentialProfileConfig.success) {
            return {
                profiles: { default: potentialProfileConfig.data },
                currentProfile: 'default',
            };
        }

        // If not a single profile, ensure it has the basic structure we expect
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'profiles' in parsed &&
            typeof parsed.profiles === 'object' &&
            parsed.profiles !== null
        ) {
            const config = parsed as Record<string, unknown>;

            // Handle migration of globalIgnore from profile level to top level
            let globalIgnore: string[] | undefined;
            const profiles = config.profiles as Record<string, Record<string, unknown>>;

            // Check if globalIgnore is at the top level (new format)
            if (Array.isArray(config.globalIgnore)) {
                globalIgnore = config.globalIgnore as string[];
            } else {
                // Check if any profile has globalIgnore and migrate it (old format)
                for (const profileConfig of Object.values(profiles)) {
                    if (Array.isArray(profileConfig?.globalIgnore)) {
                        globalIgnore = profileConfig.globalIgnore as string[];
                        // Remove globalIgnore from profile since it's now global
                        delete profileConfig.globalIgnore;
                        break; // Use the first one found
                    }
                }
            }

            return {
                currentProfile: typeof config.currentProfile === 'string' ? config.currentProfile : 'default',
                globalIgnore,
                profiles: profiles as Record<string, Partial<ProfileConfig>>,
            };
        }

        // If all else fails, return default config
        return this.getDefaultConfig();
    }

    private getDefaultConfig(): ConfigState {
        return { profiles: {}, currentProfile: 'default' };
    }

    updateConfigInMemory(config: Partial<ConfigState>): void {
        this.inMemoryConfig = {
            ...this.inMemoryConfig,
            ...config,
        };
    }

    updateProfileInMemory(profile: string, config: Partial<ProfileConfig>): void {
        const currentProfiles = this.inMemoryConfig.profiles || {};
        this.inMemoryConfig = {
            ...this.inMemoryConfig,
            profiles: {
                ...currentProfiles,
                [profile]: {
                    ...currentProfiles[profile],
                    ...config,
                },
            },
        };
    }

    getCurrentProfile(): string {
        return this.cliArguments.profile || this.env.AIC_PROFILE || this.inMemoryConfig.currentProfile || 'default';
    }

    resolveApiKeyFor({
        profile,
        provider,
        profileApiKey,
    }: {
        profile: string;
        provider: ProviderName;
        profileApiKey?: string;
    }): string | undefined {
        return resolveApiKey({
            provider,
            profile,
            profileApiKey,
            cliApiKey: this.cliArguments.apiKey,
            env: this.env,
        });
    }

    getApiKeySourceEnvVarFor({
        profile,
        provider,
        profileApiKey,
    }: {
        profile: string;
        provider: ProviderName;
        profileApiKey?: string;
    }): string | undefined {
        return getApiKeySourceEnvVar({
            provider,
            profile,
            profileApiKey,
            env: this.env,
        });
    }

    getProfile(profileName: string): ProfileConfig | undefined {
        const profile = this.inMemoryConfig.profiles?.[profileName];
        if (!profile) {
            return undefined;
        }

        const parseResult = profileConfigSchema.safeParse(profile);
        if (parseResult.success) {
            return parseResult.data;
        }

        return undefined;
    }

    getRawProfile(profileName: string): Partial<ProfileConfig> | undefined {
        return this.inMemoryConfig.profiles?.[profileName];
    }

    async flush(): Promise<void> {
        // Convert internal partial config to external format for writing
        const configToWrite: Partial<Config> = {
            currentProfile: this.inMemoryConfig.currentProfile,
            globalIgnore: this.inMemoryConfig.globalIgnore,
            profiles: this.inMemoryConfig.profiles
                ? Object.fromEntries(
                      Object.entries(this.inMemoryConfig.profiles).map(([name, profile]) => [
                          name,
                          profile as ProfileConfig, // Type assertion - we trust the caller to provide valid data
                      ]),
                  )
                : undefined,
        };

        const yamlStr = yamlStringify(configToWrite);
        await this.fs.writeFile(this.configFilePath, yamlStr, 'utf8');
    }

    /**
     * Merges the on-disk profile with raw CLI overrides. The result is intentionally
     * loosely typed (`Record<string, unknown>`) because it has not been validated yet;
     * `getConfig()`/`validConfig()` run it through `profileConfigSchema` to do that.
     */
    private getRawConfig(): Record<string, unknown> {
        const currentProfile = this.getCurrentProfile();
        const profileConfig = this.inMemoryConfig.profiles?.[currentProfile] || {};
        const cliArgs = shake(this.cliArguments);

        const exclude = this.mergeExcludePatterns(profileConfig, cliArgs);

        const merged: Record<string, unknown> = {
            ...profileConfig,
            ...cliArgs,
            exclude: exclude.length > 0 ? exclude : undefined,
        };

        const providerResult = providerNameSchema.safeParse(merged.provider);
        if (!providerResult.success) {
            return merged;
        }

        const apiKey = resolveApiKey({
            provider: providerResult.data,
            profile: currentProfile,
            profileApiKey: isString(merged.apiKey) ? merged.apiKey : undefined,
            cliApiKey: this.cliArguments.apiKey,
            env: this.env,
        });

        return {
            ...merged,
            ...(apiKey ? { apiKey } : {}),
        };
    }

    private mergeExcludePatterns(profileConfig: Partial<ProfileConfig>, cliArgs: CliArguments): string[] {
        return [...(profileConfig.exclude || []), ...(cliArgs.exclude || [])].filter(isString);
    }

    getConfig(): Readonly<ProfileConfig> {
        return profileConfigSchema.parse(this.getRawConfig());
    }

    getProfileNames(): string[] {
        return Object.keys(this.inMemoryConfig.profiles || {});
    }

    validConfig(): ConfigValidationResult {
        const rawConfig = this.getRawConfig();
        const parsedResult = profileConfigSchema.safeParse(rawConfig);

        return parsedResult.success ? { valid: true } : { valid: false, errors: parsedResult.error.issues };
    }

    getGlobalIgnorePatterns(): string[] {
        return this.inMemoryConfig.globalIgnore || [];
    }

    setGlobalIgnorePatterns(patterns: string[]): void {
        this.inMemoryConfig = {
            ...this.inMemoryConfig,
            globalIgnore: patterns,
        };
    }
}
