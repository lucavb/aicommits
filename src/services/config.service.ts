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

type FileSystemApi = Pick<typeof fs, 'writeFile' | 'readFile'>;

@Injectable()
export class ConfigService {
    private readonly configFilePath: string;
    private inMemoryConfig: Partial<Config> = {};

    constructor(
        @Optional() @Inject(CLI_ARGUMENTS) private readonly cliArguments: Partial<Config> & { profile?: string } = {},
        @Optional() @Inject(CONFIG_FILE_PATH) configFilePath: string | undefined,
        @Optional() @Inject(FILE_SYSTEM_PROMISE_API) private readonly fs: FileSystemApi,
    ) {
        this.configFilePath =
            configFilePath ?? join(process.env.HOME || process.env.USERPROFILE || '.', '.aicommits.yaml');
    }

    public getConfigFilePath(): string {
        return this.configFilePath;
    }

    async readConfig(): Promise<void> {
        try {
            const fileContents = await this.fs.readFile(this.configFilePath, 'utf8');
            const parsed = yamlParse(fileContents);
            // Handle migration from old config format
            if (parsed && !parsed.profiles) {
                this.inMemoryConfig = {
                    profiles: {
                        default: parsed,
                    },
                    currentProfile: 'default',
                };
            } else {
                this.inMemoryConfig = parsed ?? { profiles: {}, currentProfile: 'default' };
            }
        } catch (error) {
            this.inMemoryConfig = { profiles: {}, currentProfile: 'default' };
        }
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
        return this.cliArguments.profile || this.inMemoryConfig.currentProfile || 'default';
    }

    getProfile(profileName: string) {
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

        const exclude = [
            ...((profileConfig as Partial<ProfileConfig>).exclude || []),
            ...((cliArgs as Partial<ProfileConfig>).exclude || []),
        ].filter(isString);

        return {
            ...profileConfig,
            ...cliArgs,
            exclude: exclude.length > 0 ? exclude : undefined,
        } as ProfileConfig;
    }

    getConfig(): Readonly<ProfileConfig> {
        const rawConfig = this.getRawConfig();
        return profileConfigSchema.parse(rawConfig);
    }

    getProfileNames() {
        return Object.keys(this.inMemoryConfig.profiles || {});
    }

    validConfig() {
        const rawConfig = this.getRawConfig();
        const parsedResult = profileConfigSchema.safeParse(rawConfig);
        if (parsedResult.success) {
            return { valid: true } as const;
        }
        return { valid: false, errors: parsedResult.error.issues } as const;
    }
}
