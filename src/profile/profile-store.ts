import { join } from 'path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { Inject, Injectable, Optional } from '../utils/inversify';
import { type ProfileConfig } from '../utils/config';
import { type Environment, ENVIRONMENT_VARIABLES } from '../utils/env';
import { type ConfigFile, emptyConfigFile, migrateLegacyConfig } from './config-file';

export const CONFIG_FILE_PATH = Symbol.for('CONFIG_FILE_PATH');
export const FILE_SYSTEM_PROMISE_API = Symbol.for('FILE_SYSTEM_PROMISE_API');

/** The slice of `fs/promises` the store uses: UTF-8 text in and out. Node's `fs.promises` satisfies it. */
export interface FileSystemApi {
    readFile(path: string, encoding: 'utf8'): Promise<string>;
    writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
}

/**
 * The write side of the user's config file: load it, change profiles or the
 * global ignore, save it. Reading the profile in effect for a run is not done
 * here; see `resolveProfile`.
 */
@Injectable()
export class ProfileStore {
    private readonly configFilePath: string;
    private file: ConfigFile = emptyConfigFile();
    private loaded = false;

    constructor(
        @Optional() @Inject(CONFIG_FILE_PATH) configFilePath: string | undefined,
        @Inject(FILE_SYSTEM_PROMISE_API) private readonly fs: FileSystemApi,
        @Inject(ENVIRONMENT_VARIABLES) env: Environment,
    ) {
        this.configFilePath = configFilePath ?? join(env.HOME || env.USERPROFILE || '.', '.aicommits.yaml');
    }

    get filePath(): string {
        return this.configFilePath;
    }

    /**
     * Reads the file; a missing or unreadable file counts as empty. Only the
     * composition root calls this, once per run (docs/adr/0002): a second call
     * throws rather than silently re-reading the file.
     */
    async load(): Promise<ConfigFile> {
        if (this.loaded) {
            throw new Error('ProfileStore.load() was called twice; the config file is read once per run.');
        }
        this.loaded = true;
        try {
            const contents = await this.fs.readFile(this.configFilePath, 'utf8');
            this.file = migrateLegacyConfig(yamlParse(contents));
        } catch {
            this.file = emptyConfigFile();
        }
        return this.snapshot();
    }

    private snapshot(): ConfigFile {
        return structuredClone(this.file);
    }

    getRawProfile(name: string): Partial<ProfileConfig> | undefined {
        return this.file.profiles[name];
    }

    updateProfile(name: string, patch: Partial<ProfileConfig>): void {
        this.file = {
            ...this.file,
            profiles: { ...this.file.profiles, [name]: { ...this.file.profiles[name], ...patch } },
        };
    }

    /** `undefined` when the user has never set global ignore. */
    getGlobalIgnore(): string[] | undefined {
        return this.file.globalIgnore;
    }

    setGlobalIgnore(patterns: string[]): void {
        this.file = { ...this.file, globalIgnore: patterns };
    }

    async save(): Promise<void> {
        const { currentProfile, globalIgnore, profiles } = this.file;
        await this.fs.writeFile(this.configFilePath, yamlStringify({ currentProfile, globalIgnore, profiles }), 'utf8');
    }
}
