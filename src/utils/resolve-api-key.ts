import { type ProviderName } from './config';
import { type Environment } from './env';
import { KnownError } from './error';

const PROVIDER_API_KEY_ENV_VARS: Partial<Record<ProviderName, string>> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
};

const API_KEY_PROVIDERS = new Set<ProviderName>(['openai', 'anthropic', 'openrouter']);

/**
 * Maps a profile name onto its API key env var name **injectively**: every
 * accepted profile name (any non-empty string) derives a distinct env var.
 *
 * Alphanumeric characters pass through (case preserved - case-folding would
 * make case-only profiles collide), everything else - including a literal
 * uppercase "X", which would otherwise be ambiguous with the escape framing -
 * is individually hex-escaped. Collapsing non-alphanumeric characters to a
 * single "_" (the previous behavior) was non-injective: "work.dev",
 * "work-dev", "work dev", and "work_dev" all resolved to the same
 * AIC_API_KEY_WORK_DEV, so one profile's credential silently became another
 * profile's API key.
 */
export function getProfileApiKeyEnvVar(profile: string): string {
    const escaped = Array.from(profile)
        .map((char) =>
            /^[A-Z0-9a-z]$/.test(char) && char !== 'X' ? char : `X${char.codePointAt(0)!.toString(16).toUpperCase()}X`,
        )
        .join('');
    return `AIC_API_KEY_${escaped}`;
}

/**
 * Guards profile persistence: rejects saving a profile whose derived API key
 * env var is already claimed by another configured profile, so a credential
 * env var can never be shared between two profile namespaces.
 */
export function assertProfileEnvVarUniqueness(profiles: string[], candidate: string): void {
    const derived = getProfileApiKeyEnvVar(candidate);
    for (const existing of profiles) {
        if (existing !== candidate && getProfileApiKeyEnvVar(existing) === derived) {
            throw new KnownError(
                `Profile '${candidate}' collides with profile '${existing}': both derive the API key env var '${derived}'. Choose a profile name that differs by more than case or punctuation.`,
            );
        }
    }
}

export function getProviderApiKeyEnvVar(provider: ProviderName): string | undefined {
    return PROVIDER_API_KEY_ENV_VARS[provider];
}

export function getApiKeyEnvVarCandidates(provider: ProviderName, profile: string): string[] {
    if (!API_KEY_PROVIDERS.has(provider)) {
        return [];
    }

    const candidates = [getProfileApiKeyEnvVar(profile)];

    const providerEnvVar = getProviderApiKeyEnvVar(provider);
    if (providerEnvVar) {
        candidates.push(providerEnvVar);
    }

    candidates.push('AIC_API_KEY');

    return candidates;
}

export function resolveApiKeyFromEnvironment({
    provider,
    profile,
    env,
}: {
    provider: ProviderName;
    profile: string;
    env: Environment;
}): string | undefined {
    if (!API_KEY_PROVIDERS.has(provider)) {
        return undefined;
    }

    const profileEnvVar = getProfileApiKeyEnvVar(profile);
    const fromProfileEnv = env[profileEnvVar];
    if (fromProfileEnv) {
        return fromProfileEnv;
    }

    const providerEnvVar = getProviderApiKeyEnvVar(provider);
    if (providerEnvVar) {
        const fromProviderEnv = env[providerEnvVar];
        if (fromProviderEnv) {
            return fromProviderEnv;
        }
    }

    return env.AIC_API_KEY;
}

export function resolveApiKey({
    provider,
    profile,
    profileApiKey,
    cliApiKey,
    env,
}: {
    provider: ProviderName;
    profile: string;
    profileApiKey?: string;
    cliApiKey?: string;
    env: Environment;
}): string | undefined {
    if (cliApiKey?.trim()) {
        return cliApiKey.trim();
    }

    if (profileApiKey?.trim()) {
        return profileApiKey.trim();
    }

    return resolveApiKeyFromEnvironment({ provider, profile, env });
}

export function getApiKeySourceEnvVar({
    provider,
    profile,
    profileApiKey,
    env,
}: {
    provider: ProviderName;
    profile: string;
    profileApiKey?: string;
    env: Environment;
}): string | undefined {
    if (profileApiKey?.trim()) {
        return undefined;
    }

    const profileEnvVar = getProfileApiKeyEnvVar(profile);
    if (env[profileEnvVar]) {
        return profileEnvVar;
    }

    const providerEnvVar = getProviderApiKeyEnvVar(provider);
    if (providerEnvVar && env[providerEnvVar]) {
        return providerEnvVar;
    }

    if (env.AIC_API_KEY) {
        return 'AIC_API_KEY';
    }

    return undefined;
}
