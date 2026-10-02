import { join } from 'path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { Inject, Injectable, Optional } from '../utils/inversify';
import { type ProfileConfig, profileConfigSchema } from '../utils/config';
import { type Environment } from '../utils/env';
import { type ConfigFile, ENVIRONMENT_VARIABLES } from './resolved-profile';

export const CONFIG_FILE_PATH = Symbol.for('CONFIG_FILE_PATH');
export const FILE_SYSTEM_PROMISE_API = Symbol.for('FILE_SYSTEM_PROMISE_API');

/** The slice of `fs/promises` the store uses: UTF-8 text in and out. Node's `fs.promises` satisfies it. */
export interface FileSystemApi {
    readFile(path: string, encoding: 'utf8'): Promise<string>;
    writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>;
}

const emptyConfigFile = (): ConfigFile => ({ profiles: {}, currentProfile: 'default' });

/**
 * Turns whatever is on disk into the current `ConfigFile` shape:
 * - a bare single-profile file (legacy) becomes the `default` profile;
 * - a `globalIgnore` stored inside a profile (legacy) moves to the top level.
 */
export function migrateLegacyConfig(parsed: unknown): ConfigFile {
    const legacySingleProfile = profileConfigSchema.safeParse(parsed);
    if (legacySingleProfile.success) {
        return { profiles: { default: legacySingleProfile.data }, currentProfile: 'default' };
    }

    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('profiles' in parsed) ||
        typeof parsed.profiles !== 'object' ||
        parsed.profiles === null
    ) {
        return emptyConfigFile();
    }

    const config = parsed as Record<string, unknown>;
    const profiles = config.profiles as Record<string, Record<string, unknown>>;

    let globalIgnore: string[] | undefined;
    if (Array.isArray(config.globalIgnore)) {
        globalIgnore = config.globalIgnore as string[];
    } else {
        for (const profileConfig of Object.values(profiles)) {
            if (Array.isArray(profileConfig?.globalIgnore)) {
                globalIgnore = profileConfig.globalIgnore as string[];
                delete profileConfig.globalIgnore;
                break;
            }
        }
    }

    return {
        currentProfile: typeof config.currentProfile === 'string' ? config.currentProfile : 'default',
        globalIgnore,
        profiles: profiles as Record<string, Partial<ProfileConfig>>,
    };
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

    /** Reads the file; a missing or unreadable file counts as empty. */
    async load(): Promise<ConfigFile> {
        try {
            const contents = await this.fs.readFile(this.configFilePath, 'utf8');
            this.file = migrateLegacyConfig(yamlParse(contents));
        } catch {
            this.file = emptyConfigFile();
        }
        return this.snapshot();
    }

    snapshot(): ConfigFile {
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
