import { shake } from 'radash';
import { type z } from 'zod';
import { KnownError } from '../utils/error';
import { type ProfileConfig, profileConfigSchema, type ProviderName } from '../utils/config';
import { type Environment } from '../utils/env';
import { type ConfigFile, globalIgnoreInEffect } from './config-file';

export const CLI_ARGUMENTS = Symbol.for('CLI_ARGUMENTS');
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

/** Everything the credential precedence looks at. */
export interface CredentialLookup {
    profileName: string;
    provider: ProviderName;
    profileApiKey?: string;
    cliApiKey?: string;
    env: Environment;
}

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
}: CredentialLookup): Credential {
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
    | {
          status: 'invalid';
          name: string;
          /** Whether the stored profile is broken, or only the command-line overrides applied to it. */
          cause: 'profile' | 'command-line';
          issues: string[];
      };

export type ReadyProfile = Extract<ResolvedProfile, { status: 'ready' }>;
export type UnusableProfile = Exclude<ResolvedProfile, ReadyProfile>;

/** Injected under READY_PROFILE: call it at use time; throws a KnownError unless the profile is ready. */
export type ReadyProfileAccessor = () => ReadyProfile;

const selectProfileName = (cli: CliArguments, env: Environment, file: ConfigFile): string =>
    cli.profile?.trim() || env.AIC_PROFILE || file.currentProfile || 'default';

/** Only some providers' settings carry an `apiKey`; the credential holds it instead of the settings. */
const splitOffApiKey = (
    settingsWithKey: DistributiveOmit<ProfileConfig, 'exclude'>,
): { profileApiKey?: string; settings: ProfileSettings } => {
    if (!('apiKey' in settingsWithKey)) {
        return { settings: settingsWithKey };
    }
    const { apiKey: profileApiKey, ...settings } = settingsWithKey;
    return { profileApiKey, settings };
};

const describeIssues = (error: z.ZodError): string[] =>
    error.issues.map((issue) => `${issue.path.join('.') || 'profile'}: ${issue.message}`);

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

    const storedResult = profileConfigSchema.safeParse(stored);
    if (!storedResult.success) {
        return { status: 'invalid', name, cause: 'profile', issues: describeIssues(storedResult.error) };
    }

    const {
        apiKey: cliApiKey,
        exclude: cliExclude,
        baseUrl,
        contextLines,
        locale,
        maxLength,
        model,
        type,
    } = cliArguments;
    const overrides = shake({ baseUrl, contextLines, locale, maxLength, model, type });
    // CLI excludes are appended to the profile's so the schema validates them too.
    const exclude = cliExclude?.length ? [...(storedResult.data.exclude ?? []), ...cliExclude] : undefined;
    const merged = profileConfigSchema.safeParse({ ...stored, ...overrides, ...(exclude && { exclude }) });
    if (!merged.success) {
        return { status: 'invalid', name, cause: 'command-line', issues: describeIssues(merged.error) };
    }

    const { exclude: profileAndCliExclude = [], ...settingsWithKey } = merged.data;
    const { profileApiKey, settings } = splitOffApiKey(settingsWithKey);

    return {
        status: 'ready',
        name,
        settings,
        exclude: [...new Set([...globalIgnoreInEffect(file), ...profileAndCliExclude])],
        credential: locateCredential({ profileName: name, provider: settings.provider, profileApiKey, cliApiKey, env }),
    };
}

/**
 * What is wrong with an unusable profile and how to fix it, as lines of text.
 * `highlight` styles the commands the user should run.
 */
export function describeUnusableProfile(
    resolved: UnusableProfile,
    highlight: (command: string) => string = (command) => command,
): string[] {
    const setup = highlight(`aicommits setup --profile ${resolved.name}`);

    if (resolved.status === 'missing') {
        if (resolved.available.length === 0) {
            return [
                "It looks like you haven't set up aicommits yet. Let's get you started!",
                '',
                `Run ${highlight('aicommits setup')} to configure your settings.`,
            ];
        }
        return [
            `Profile "${resolved.name}" not found. Available profiles: ${resolved.available.join(', ')}`,
            '',
            `Run ${setup} to create it.`,
        ];
    }

    const issues = resolved.issues.map((issue) => `  - ${issue}`);
    if (resolved.cause === 'command-line') {
        return [
            `The command-line options are invalid for profile "${resolved.name}":`,
            ...issues,
            '',
            'The stored profile is fine; correct those options and try again.',
        ];
    }
    return [`Profile "${resolved.name}" is invalid:`, ...issues, '', `Run ${setup} to fix it.`];
}

export function requireReady(resolved: ResolvedProfile): ReadyProfile {
    if (resolved.status === 'ready') {
        return resolved;
    }
    throw new KnownError(describeUnusableProfile(resolved).join('\n'));
}
