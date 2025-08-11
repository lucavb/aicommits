import { join } from 'path';

import { Config, ProfileConfig, profileConfigSchema } from '../utils/config';
import type { promises as fs } from 'fs';
import { isString } from '../utils/typeguards';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { shake } from 'radash';
import { Inject, Injectable, Optional } from '../utils/inversify';

export const CLI_ARGUMENTS = Symbol.for('CLI_ARGUMENTS');
export const CONFIG_FILE_PATH = Symbol.for('CONFIG_FILE_PATH');
export const FILE_SYSTEM_PROMISE_API = Symbol.for('FILE_SYSTEM_PROMISE_API');
export const ENVIRONMENT_VARIABLES = Symbol.for('ENVIRONMENT_VARIABLES');

type FileSystemApi = Pick<typeof fs, 'writeFile' | 'readFile'>;
interface EnvironmentVariables {
    HOME?: string;
    USERPROFILE?: string;
    AIC_PROFILE?: string;
}
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
        @Optional() @Inject(CLI_ARGUMENTS) private readonly cliArguments: Partial<Config> & { profile?: string } = {},
        @Optional() @Inject(CONFIG_FILE_PATH) configFilePath: string | undefined,
        @Optional() @Inject(ENVIRONMENT_VARIABLES) private readonly env: EnvironmentVariables = {},
        @Optional() @Inject(FILE_SYSTEM_PROMISE_API) private readonly fs: FileSystemApi,
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

        // Check for Ollama configs and show helpful migration message
        this.checkForOllamaConfigs(parsed);

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

    private checkForOllamaConfigs(parsed: unknown): void {
        if (typeof parsed !== 'object' || parsed === null) {
            return;
        }

        const config = parsed as Record<string, unknown>;

        // Check single profile config (legacy format)
        if (config.provider === 'ollama') {
            this.showOllamaMigrationWarning();
            return;
        }

        // Check multi-profile config
        if (config.profiles && typeof config.profiles === 'object') {
            const profiles = config.profiles as Record<string, unknown>;

            for (const [profileName, profile] of Object.entries(profiles)) {
                if (typeof profile === 'object' && profile !== null) {
                    const profileObj = profile as Record<string, unknown>;
                    if (profileObj.provider === 'ollama') {
                        this.showOllamaMigrationWarning(profileName);
                        return;
                    }
                }
            }
        }
    }

    private showOllamaMigrationWarning(profileName?: string): void {
        const profileInfo = profileName ? ` in profile "${profileName}"` : '';

        console.warn(`\n⚠️  Ollama configuration detected${profileInfo}!`);
        console.warn('\nDirect Ollama support has been temporarily removed in favor of Vercel AI SDK v5.');
        console.warn('\nTo continue using Ollama:');
        console.warn('1. Start Ollama with: OLLAMA_ORIGINS="*" ollama serve');
        console.warn(`2. Run: aicommits setup${profileName ? ` --profile ${profileName}` : ''}`);
        console.warn('3. Choose "OpenAI (compatible)" as provider');
        console.warn('4. Set base URL: http://localhost:11434/v1');
        console.warn('5. Use any API key (Ollama ignores it)');
        console.warn('6. Select your local model name\n');

        throw new Error(`Ollama configuration found${profileInfo}. Please run setup to reconfigure.`);
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

    getProfile(profileName: string): ProfileConfig | undefined {
        const profile = this.inMemoryConfig.profiles?.[profileName];
        if (!profile) {
            return undefined;
        }

        const parseResult = profileConfigSchema.safeParse(profile);
        if (parseResult.success) {
            return parseResult.data;
        }

        // Check if this is an Ollama config and show migration guidance
        if (typeof profile === 'object' && profile !== null) {
            const profileObj = profile as Record<string, unknown>;
            if (profileObj.provider === 'ollama') {
                this.showOllamaMigrationWarning(profileName);
            }
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

    private getRawConfig() {
        const currentProfile = this.getCurrentProfile();
        const profileConfig = this.inMemoryConfig.profiles?.[currentProfile] || {};
        const cliArgs = shake(this.cliArguments);

        const exclude = this.mergeExcludePatterns(profileConfig, cliArgs);

        return {
            ...profileConfig,
            ...cliArgs,
            exclude: exclude.length > 0 ? exclude : undefined,
        } as const satisfies Partial<ProfileConfig>;
    }

    private mergeExcludePatterns(profileConfig: Partial<ProfileConfig>, cliArgs: Partial<ProfileConfig>): string[] {
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
