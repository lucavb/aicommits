import { join } from 'path';

import { Config, ProfileConfig, profileConfigSchema, providerNameSchema, ProviderName } from '../utils/config';
import type { promises as fs } from 'fs';
import { isError, isString } from '../utils/typeguards';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { shake } from 'radash';
import { Inject, Injectable, Optional } from '../utils/inversify';
import { type Environment } from '../utils/env';
import { KnownError } from '../utils/error';
import { resolveApiKey, getApiKeySourceEnvVar } from '../utils/resolve-api-key';

export const CLI_ARGUMENTS = Symbol.for('CLI_ARGUMENTS');
export const CONFIG_FILE_PATH = Symbol.for('CONFIG_FILE_PATH');
export const FILE_SYSTEM_PROMISE_API = Symbol.for('FILE_SYSTEM_PROMISE_API');
export const ENVIRONMENT_VARIABLES = Symbol.for('ENVIRONMENT_VARIABLES');

/**
 * The file operations the config service needs. `writeFile`/`readFile` are
 * always required; `rename` and `chmod` are only needed by `flush()` (atomic
 * write + owner-only mode) and are therefore typed as optional so lightweight
 * consumers can still provide a partial API.
 */
export type FileSystemApi = Pick<typeof fs, 'writeFile' | 'readFile'> & Partial<Pick<typeof fs, 'rename' | 'chmod'>>;

const describeError = (error: unknown): string => (isError(error) ? error.message : String(error));
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
    /**
     * Set when the on-disk config file exists but could not be read, parsed, or
     * mapped to a known config format. A failed read never defaults to an empty
     * config in memory, and `flush()` refuses to persist while this flag is set,
     * so a damaged file can never be silently destroyed by a read-modify-write
     * command.
     */
    private configReadFailed = false;

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
        this.configReadFailed = false;
        this.inMemoryConfig = {};

        let fileContents: string;
        try {
            fileContents = await this.fs.readFile(this.configFilePath, 'utf8');
        } catch (error) {
            // Only a genuinely missing file may fall back to defaults. Every
            // other read failure (denied, directory, I/O failure, ...) is an
            // existing file we know nothing about and must never be replaced.
            if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
                this.inMemoryConfig = this.getDefaultConfig();
                return;
            }
            this.configReadFailed = true;
            throw new KnownError(`Can not read the config file ${this.configFilePath}: ${describeError(error)}`);
        }

        let parsed: unknown;
        try {
            parsed = yamlParse(fileContents);
        } catch (error) {
            this.configReadFailed = true;
            throw new KnownError(
                `The config file ${this.configFilePath} exists but is not valid YAML: ${describeError(error)}; refusing to overwrite it with defaults. Fix or remove the file, then try again.`,
            );
        }

        this.inMemoryConfig = this.migrateLegacyConfig(parsed);
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

        // The file exists and parses as YAML but matches neither the current
        // profiles format nor the legacy single-profile format, so it may hold
        // configuration we do not recognize - possibly including API keys.
        // Never fall back to defaults here: the next read-modify-write command
        // would flush those defaults over the real file and destroy it.
        this.configReadFailed = true;
        throw new KnownError(
            `The config file ${this.configFilePath} exists but its format is not recognized; refusing to overwrite it with defaults. Fix or remove the file, then try again.`,
        );
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
        if (this.configReadFailed) {
            throw new KnownError(
                `Can not save config: ${this.configFilePath} exists but could not be read or parsed; refusing to overwrite the existing configuration.`,
            );
        }

        const { rename, chmod } = this.fs;
        if (!rename || !chmod) {
            throw new Error(
                'FileSystemApi does not support rename and chmod, which are required to persist the config atomically with owner-only access. Please open a Bug report at https://github.com/lucavb/aicommits/issues/new/choose',
            );
        }

        // Convert internal partial config to external format for writing
        const configToWrite: Partial<Config> = {
            currentProfile: this.inMemoryConfig.currentProfile,
            globalIgnore: this.inMemoryConfig.globalIgnore,
            profiles: Object.fromEntries(
                Object.entries(this.inMemoryConfig.profiles ?? {}).map(([name, profile]) => [
                    name,
                    profile as ProfileConfig, // Type assertion - we trust the caller to provide valid data
                ]),
            ),
        };

        const yamlStr = yamlStringify(configToWrite);

        // The config file holds plaintext API credentials, so it is always
        // written with owner-only permissions (0o600), independent of the
        // invoking process umask. Write to a temp file and rename so an
        // interrupted write can never corrupt the existing config; writeFile
        // only applies `mode` at creation, hence the explicit chmod that also
        // covers the case of a leftover permissive temp file from a previous
        // interrupted run. The rename swaps the whole inode, which also
        // tightens a previously permissive config file.
        const tempFilePath = `${this.configFilePath}.tmp`;
        await this.fs.writeFile(tempFilePath, yamlStr, { encoding: 'utf8', mode: 0o600 });
        await chmod(tempFilePath, 0o600);
        await rename(tempFilePath, this.configFilePath);
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
