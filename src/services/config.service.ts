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

        return configSchema.parse(parsed);
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
        return profile ? profileConfigSchema.parse(profile) : undefined;
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
