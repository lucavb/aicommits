import { join } from 'path';
import type { promises as fs } from 'fs';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { Inject, Injectable, Optional } from '../utils/inversify';
import { type ProfileConfig } from '../utils/config';
import { isError } from '../utils/typeguards';
import { KnownError } from '../utils/error';
import { type Environment, ENVIRONMENT_VARIABLES } from '../utils/env';
import { type ConfigFile, emptyConfigFile, migrateLegacyConfig } from './config-file';

export const CONFIG_FILE_PATH = Symbol.for('CONFIG_FILE_PATH');
export const FILE_SYSTEM_PROMISE_API = Symbol.for('FILE_SYSTEM_PROMISE_API');

/**
 * The file operations the store needs. `writeFile`/`readFile` are always
 * required; `rename` and `chmod` are only needed by `save()` (atomic write +
 * owner-only mode) and are therefore typed as optional so lightweight
 * consumers can still provide a partial API.
 */
export type FileSystemApi = Pick<typeof fs, 'writeFile' | 'readFile'> & Partial<Pick<typeof fs, 'rename' | 'chmod'>>;

const describeError = (error: unknown): string => (isError(error) ? error.message : String(error));

/**
 * The write side of the user's config file: load it, change profiles or the
 * global ignore, save it. Reading the profile in effect for a run is not done
 * here; see `resolveProfile`.
 */
@Injectable()
export class ProfileStore {
    private readonly configFilePath: string;
    private file: ConfigFile = emptyConfigFile();
    /** Set once load() is entered, so the file is read at most once per run. */
    private readAttempted = false;
    /** Set only when load() succeeded; `save()` refuses to write otherwise. */
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
     * Reads the file; only a genuinely missing file (ENOENT) falls back to an
     * empty config. Every other read failure, invalid YAML, and an
     * unrecognized document format throw a `KnownError` so a damaged file is
     * never silently replaced by defaults and then overwritten on save. Only
     * the composition root calls this, once per run (docs/adr/0002): a second
     * call throws rather than silently re-reading the file.
     */
    async load(): Promise<ConfigFile> {
        if (this.readAttempted) {
            throw new Error('ProfileStore.load() was called twice; the config file is read once per run.');
        }
        this.readAttempted = true;

        let contents: string;
        try {
            contents = await this.fs.readFile(this.configFilePath, 'utf8');
        } catch (error) {
            // Only a genuinely missing file may fall back to defaults. Every
            // other read failure (denied, directory, I/O failure, ...) is an
            // existing file we know nothing about and must never be replaced.
            if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
                this.file = emptyConfigFile();
                this.loaded = true;
                return this.snapshot();
            }
            throw new KnownError(`Can not read the config file ${this.configFilePath}: ${describeError(error)}`);
        }

        let parsed: unknown;
        try {
            parsed = yamlParse(contents);
        } catch (error) {
            throw new KnownError(
                `The config file ${this.configFilePath} exists but is not valid YAML: ${describeError(error)}; refusing to overwrite it with defaults. Fix or remove the file, then try again.`,
            );
        }

        this.file = migrateLegacyConfig(parsed, this.configFilePath);
        this.loaded = true;
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

    getProfileNames(): string[] {
        return Object.keys(this.file.profiles);
    }

    setGlobalIgnore(patterns: string[]): void {
        this.file = { ...this.file, globalIgnore: patterns };
    }

    async save(): Promise<void> {
        // A failed load leaves the store empty in memory; writing that state
        // over the real file would destroy configuration it never saw, so
        // saving is only possible after a successful load.
        if (!this.loaded) {
            throw new Error(
                'ProfileStore.save() was called before a successful load(); refusing to write a config file the store has not read.',
            );
        }

        const { rename, chmod } = this.fs;
        if (!rename || !chmod) {
            throw new Error(
                'FileSystemApi does not support rename and chmod, which are required to persist the config atomically with owner-only access. Please open a Bug report at https://github.com/lucavb/aicommits/issues/new/choose',
            );
        }

        const { currentProfile, globalIgnore, profiles } = this.file;
        const yaml = yamlStringify({ currentProfile, globalIgnore, profiles });

        // The config file holds plaintext API credentials, so it is always
        // written with owner-only permissions (0o600), independent of the
        // invoking process umask. Write to a temp file and rename so an
        // interrupted write can never corrupt the existing config; writeFile
        // only applies `mode` at creation, hence the explicit chmod that also
        // covers the case of a leftover permissive temp file from a previous
        // interrupted run. The rename swaps the whole inode, which also
        // tightens a previously permissive config file.
        const tempFilePath = `${this.configFilePath}.tmp`;
        await this.fs.writeFile(tempFilePath, yaml, { encoding: 'utf8', mode: 0o600 });
        await chmod(tempFilePath, 0o600);
        await rename(tempFilePath, this.configFilePath);
    }
}
