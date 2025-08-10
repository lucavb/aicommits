import { join } from 'path';

import { Config, configSchema, ProfileConfig, profileConfigSchema } from '../utils/config';
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
    profiles: Record<string, ProfileConfig>;
    currentProfile: string;
}

@Injectable()
export class ConfigService {
    private readonly configFilePath: string;
    private inMemoryConfig: Partial<Config> = {};

    constructor(
        @Optional() @Inject(CLI_ARGUMENTS) private readonly cliArguments: Partial<Config> & { profile?: string } = {},
        @Optional() @Inject(CONFIG_FILE_PATH) configFilePath: string | undefined,
        @Optional() @Inject(FILE_SYSTEM_PROMISE_API) private readonly fs: FileSystemApi,
        @Optional() @Inject(ENVIRONMENT_VARIABLES) private readonly env: EnvironmentVariables = {},
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

    private migrateLegacyConfig(parsed: unknown) {
        const potentialProfileConfig = profileConfigSchema.safeParse(parsed);
        if (potentialProfileConfig.success) {
            return {
                profiles: { default: potentialProfileConfig.data },
                currentProfile: 'default',
            };
        }

        // Check for Ollama configs and show helpful migration message
        this.checkForOllamaConfigs(parsed);

        return configSchema.parse(parsed);
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

    updateConfigInMemory(config: Partial<Config>): void {
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

    async flush(): Promise<void> {
        const yamlStr = yamlStringify(this.inMemoryConfig);
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
}
