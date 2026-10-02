import { type ProfileConfig, profileConfigSchema } from '../utils/config';
import { KnownError } from '../utils/error';

/** The user's config file as stored on disk (after legacy migration), unvalidated. */
export interface ConfigFile {
    profiles: Record<string, Partial<ProfileConfig>>;
    currentProfile?: string;
    globalIgnore?: string[];
}

export const emptyConfigFile = (): ConfigFile => ({ profiles: {}, currentProfile: 'default' });

export const DEFAULT_GLOBAL_IGNORE: readonly string[] = [
    'package-lock.json',
    'pnpm-lock.yaml',
    '*.lock', // yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
];

/** Global ignore in effect: the user's patterns if they ever set them (even to `[]`), built-in defaults otherwise. */
export const globalIgnoreInEffect = (file: Pick<ConfigFile, 'globalIgnore'>): string[] =>
    file.globalIgnore === undefined ? [...DEFAULT_GLOBAL_IGNORE] : [...file.globalIgnore];

/**
 * Turns whatever is on disk into the current `ConfigFile` shape:
 * - a bare single-profile file (legacy) becomes the `default` profile;
 * - a `globalIgnore` stored inside a profile (legacy) moves to the top level.
 *
 * Anything the file exists but matches neither format is an error: it may hold
 * configuration we do not recognize - possibly including API keys - so it is
 * never silently replaced by the empty defaults.
 */
export function migrateLegacyConfig(parsed: unknown, filePath?: string): ConfigFile {
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
        // The file parses as YAML but matches neither the current profiles
        // format nor the legacy single-profile format. Never fall back to
        // defaults here: the next read-modify-write command would save those
        // defaults over the real file and destroy its contents.
        const where = filePath ? `The config file ${filePath}` : 'The config file';
        throw new KnownError(
            `${where} exists but its format is not recognized; refusing to overwrite it with defaults. Fix or remove the file, then try again.`,
        );
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
