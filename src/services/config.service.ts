import { join } from 'path';

import { Config, configSchema } from '../utils/config';
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
        @Optional() @Inject(CLI_ARGUMENTS) private readonly cliArguments: Partial<Config> = {},
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
            this.inMemoryConfig = yamlParse(fileContents) ?? {};
        } catch (error) {
            this.inMemoryConfig = {};
        }
    }

    updateConfigInMemory(config: Partial<Config>): void {
        this.inMemoryConfig = {
            ...this.inMemoryConfig,
            ...config,
        };
    }

    async flush(): Promise<void> {
        const yamlStr = yamlStringify(this.inMemoryConfig);
        await this.fs.writeFile(this.configFilePath, yamlStr, 'utf8');
    }

    private getRawConfig() {
        return {
            ...this.inMemoryConfig,
            ...shake(this.cliArguments),
            exclude: [...(this.inMemoryConfig.exclude ?? []), this.cliArguments.exclude].filter(isString),
        } as const;
    }

    getConfig(): Readonly<Config> {
        const rawConfig = this.getRawConfig();
        return configSchema.parse(rawConfig);
    }

    validConfig() {
        const rawConfig = this.getRawConfig();
        const parsedResult = configSchema.safeParse(rawConfig);
        if (parsedResult.success) {
            return { valid: true } as const;
        }
        return { valid: false, errors: parsedResult.error.issues } as const;
    }
}
