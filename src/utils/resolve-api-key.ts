import { type ProviderName } from './config';
import { type Environment } from './env';

const PROVIDER_API_KEY_ENV_VARS: Partial<Record<ProviderName, string>> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
};

const API_KEY_PROVIDERS = new Set<ProviderName>(['openai', 'anthropic', 'openrouter']);

export function getProfileApiKeyEnvVar(profile: string): string {
    const suffix = profile.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return `AIC_API_KEY_${suffix}`;
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
