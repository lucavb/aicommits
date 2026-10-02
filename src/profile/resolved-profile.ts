import { shake } from 'radash';
import { KnownError } from '../utils/error';
import { type ProfileConfig, profileConfigSchema, type ProviderName } from '../utils/config';
import { type Environment } from '../utils/env';

export const CLI_ARGUMENTS = Symbol.for('CLI_ARGUMENTS');
export const ENVIRONMENT_VARIABLES = Symbol.for('ENVIRONMENT_VARIABLES');
export const RESOLVED_PROFILE = Symbol.for('RESOLVED_PROFILE');
export const READY_PROFILE = Symbol.for('READY_PROFILE');

/**
 * Raw, unvalidated overrides as they arrive from the CLI parser. `locale` and `type`
 * are plain strings because Commander cannot guarantee they're valid; the profile
 * schema validates them once they're merged into the selected profile.
 */
export type CliArguments = {
    profile?: string;
    apiKey?: string;
    baseUrl?: string;
    contextLines?: number;
    exclude?: string[];
    locale?: string;
    maxLength?: number;
    model?: string;
    type?: string;
};

/** The user's config file as stored on disk (after legacy migration), unvalidated. */
export interface ConfigFile {
    profiles: Record<string, Partial<ProfileConfig>>;
    currentProfile?: string;
    globalIgnore?: string[];
}

export const DEFAULT_GLOBAL_IGNORE: readonly string[] = [
    'package-lock.json',
    'pnpm-lock.yaml',
    '*.lock', // yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
];

/** Global ignore in effect: the user's patterns if they ever set them (even to `[]`), built-in defaults otherwise. */
export const effectiveGlobalIgnore = (file: Pick<ConfigFile, 'globalIgnore'>): string[] =>
    file.globalIgnore === undefined ? [...DEFAULT_GLOBAL_IGNORE] : [...file.globalIgnore];

export type CredentialSource = { kind: 'cli' } | { kind: 'profile' } | { kind: 'environment'; variable: string };

export interface Credential {
    /** Whether the provider needs an API key at all (bedrock and ollama don't). */
    required: boolean;
    value?: string;
    source?: CredentialSource;
    /** Environment variables that would be consulted, in precedence order. Empty when not required. */
    candidates: string[];
}

const PROVIDER_API_KEY_ENV_VARS = {
    anthropic: 'ANTHROPIC_API_KEY',
    bedrock: undefined,
    ollama: undefined,
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
} as const satisfies Record<ProviderName, string | undefined>;

export const getProfileApiKeyEnvVar = (profile: string): string =>
    `AIC_API_KEY_${profile.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

/**
 * The one place the credential precedence lives:
 * `--api-key` > profile `apiKey` > `AIC_API_KEY_<PROFILE>` > provider env var > `AIC_API_KEY`.
 */
export function locateCredential({
    profileName,
    provider,
    profileApiKey,
    cliApiKey,
    env,
}: {
    profileName: string;
    provider: ProviderName;
    profileApiKey?: string;
    cliApiKey?: string;
    env: Environment;
}): Credential {
    const providerEnvVar: string | undefined = PROVIDER_API_KEY_ENV_VARS[provider];
    if (!providerEnvVar) {
        return { required: false, candidates: [] };
    }

    const candidates = [getProfileApiKeyEnvVar(profileName), providerEnvVar, 'AIC_API_KEY'];
    const base = { required: true, candidates };

    if (cliApiKey?.trim()) {
        return { ...base, value: cliApiKey.trim(), source: { kind: 'cli' } };
    }
    if (profileApiKey?.trim()) {
        return { ...base, value: profileApiKey.trim(), source: { kind: 'profile' } };
    }
    for (const variable of candidates) {
        const value = env[variable];
        if (value) {
            return { ...base, value, source: { kind: 'environment', variable } };
        }
    }
    return base;
}

export const describeCredentialSource = (source: CredentialSource): string => {
    switch (source.kind) {
        case 'cli':
            return '--api-key';
        case 'profile':
            return 'profile';
        case 'environment':
            return source.variable;
    }
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Validated profile settings with CLI overrides applied. Excludes and the API key live beside it. */
export type ProfileSettings = DistributiveOmit<ProfileConfig, 'apiKey' | 'exclude'>;

export type ResolvedProfile =
    | {
          status: 'ready';
          name: string;
          settings: ProfileSettings;
          /** Global ignore + profile excludes + CLI excludes. */
          exclude: string[];
          credential: Credential;
      }
    | { status: 'missing'; name: string; available: string[] }
    | { status: 'invalid'; name: string; issues: string[] };

export type ReadyProfile = Extract<ResolvedProfile, { status: 'ready' }>;

/** Injected under READY_PROFILE: call it at use time; throws a KnownError unless the profile is ready. */
export type ReadyProfileAccessor = () => ReadyProfile;

const selectProfileName = (cli: CliArguments, env: Environment, file: ConfigFile): string =>
    cli.profile?.trim() || env.AIC_PROFILE || file.currentProfile || 'default';

export function resolveProfile({
    file,
    cliArguments,
    env,
}: {
    file: ConfigFile;
    cliArguments: CliArguments;
    env: Environment;
}): ResolvedProfile {
    const name = selectProfileName(cliArguments, env, file);
    const stored = file.profiles[name];
    if (!stored) {
        return { status: 'missing', name, available: Object.keys(file.profiles) };
    }

    const {
        apiKey: cliApiKey,
        exclude: cliExclude = [],
        baseUrl,
        contextLines,
        locale,
        maxLength,
        model,
        type,
    } = cliArguments;
    const overrides = shake({ baseUrl, contextLines, locale, maxLength, model, type });
    const parsed = profileConfigSchema.safeParse({ ...stored, ...overrides });
    if (!parsed.success) {
        return {
            status: 'invalid',
            name,
            issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'profile'}: ${issue.message}`),
        };
    }

    const { exclude: profileExclude = [], ...withKey } = parsed.data;
    const { apiKey: profileApiKey, ...rest } = withKey as typeof withKey & { apiKey?: string };
    const settings = rest as ProfileSettings;

    return {
        status: 'ready',
        name,
        settings,
        exclude: [...effectiveGlobalIgnore(file), ...profileExclude, ...cliExclude],
        credential: locateCredential({
            profileName: name,
            provider: settings.provider,
            profileApiKey,
            cliApiKey,
            env,
        }),
    };
}

export function requireReady(resolved: ResolvedProfile): ReadyProfile {
    switch (resolved.status) {
        case 'ready':
            return resolved;
        case 'missing':
            throw new KnownError(
                `Profile "${resolved.name}" not found. Run \`aicommits setup --profile ${resolved.name}\` to create it.`,
            );
        case 'invalid':
            throw new KnownError(
                `Profile "${resolved.name}" is invalid:\n  ${resolved.issues.join('\n  ')}\nRun \`aicommits setup --profile ${resolved.name}\` to fix it.`,
            );
    }
}
