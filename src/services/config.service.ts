import { join } from 'path';

import { Config, configSchema } from '../utils/config';
import type { promises as fs } from 'fs';
import { isString } from '../utils/typeguards';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { shake } from 'radash';
import { Inject, Injectable, Optional } from '../utils/inversify';
import type { ZodIssue } from 'zod';

export const CLI_ARGUMENTS = Symbol.for('CLI_ARGUMENTS');
export const CONFIG_FILE_PATH = Symbol.for('CONFIG_FILE_PATH');
export const FILE_SYSTEM_PROMISE_API = Symbol.for('FILE_SYSTEM_PROMISE_API');

type FileSystemApi = Pick<typeof fs, 'writeFile' | 'readFile'>;

@Injectable()
export class ConfigService {
    private readonly configFilePath: string;

    constructor(
        @Optional() @Inject(CLI_ARGUMENTS) private readonly cliArguments: Partial<Config> = {},
        @Optional() @Inject(CONFIG_FILE_PATH) configFilePath: string | undefined,
        @Optional() @Inject(FILE_SYSTEM_PROMISE_API) private readonly fs: FileSystemApi,
    ) {
        this.configFilePath =
            configFilePath ?? join(process.env.HOME || process.env.USERPROFILE || '.', '.aicommits.yaml');
    }

    async readConfig(): Promise<Partial<Config>> {
        try {
            const fileContents = await this.fs.readFile(this.configFilePath, 'utf8');
            return yamlParse(fileContents) ?? {};
        } catch (error) {
            return {};
        }
    }

    async writeConfig(config: Partial<Config>): Promise<void> {
        const yamlStr = yamlStringify(config);
        await this.fs.writeFile(this.configFilePath, yamlStr, 'utf8');
    }

    private async getRawConfig() {
        const savedConfig = await this.readConfig();
        return {
            ...savedConfig,
            ...shake(this.cliArguments),
            exclude: [...(savedConfig.exclude ?? []), this.cliArguments.exclude].filter(isString),
        } as const;
    }

    async getConfig(): Promise<Readonly<Config>> {
        const rawConfig = await this.getRawConfig();
        return configSchema.parse(rawConfig);
    }

    async validConfig(): Promise<{ valid: true } | { valid: false; errors: ZodIssue[] }> {
        const rawConfig = await this.getRawConfig();
        const parsedResult = configSchema.safeParse(rawConfig);
        if (parsedResult.success) {
            return { valid: true };
        }
        return { valid: false, errors: parsedResult.error.issues };
    }
}
