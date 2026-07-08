import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './env';
import {
    getApiKeyEnvVarCandidates,
    getProfileApiKeyEnvVar,
    resolveApiKey,
    resolveApiKeyFromEnvironment,
} from './resolve-api-key';

describe('getProfileApiKeyEnvVar', () => {
    it('should normalize profile names to env var suffixes', () => {
        expect(getProfileApiKeyEnvVar('work')).toBe('AIC_API_KEY_WORK');
        expect(getProfileApiKeyEnvVar('my-work')).toBe('AIC_API_KEY_MY_WORK');
    });
});

describe('resolveApiKeyFromEnvironment', () => {
    it('should prefer profile-scoped env vars over provider env vars', () => {
        const env = parseEnvironment({
            AIC_API_KEY_WORK: 'sk-profile',
            OPENAI_API_KEY: 'sk-provider',
            AIC_API_KEY: 'sk-generic',
        });

        expect(
            resolveApiKeyFromEnvironment({
                provider: 'openai',
                profile: 'work',
                env,
            }),
        ).toBe('sk-profile');
    });

    it('should fall back to provider env vars', () => {
        const env = parseEnvironment({
            OPENAI_API_KEY: 'sk-provider',
            AIC_API_KEY: 'sk-generic',
        });

        expect(
            resolveApiKeyFromEnvironment({
                provider: 'openai',
                profile: 'work',
                env,
            }),
        ).toBe('sk-provider');
    });

    it('should fall back to generic AIC_API_KEY', () => {
        const env = parseEnvironment({
            AIC_API_KEY: 'sk-generic',
        });

        expect(
            resolveApiKeyFromEnvironment({
                provider: 'anthropic',
                profile: 'default',
                env,
            }),
        ).toBe('sk-generic');
    });

    it('should return undefined for providers without api keys', () => {
        const env = parseEnvironment({
            AIC_API_KEY: 'sk-generic',
        });

        expect(
            resolveApiKeyFromEnvironment({
                provider: 'ollama',
                profile: 'default',
                env,
            }),
        ).toBeUndefined();
    });
});

describe('resolveApiKey', () => {
    const env = parseEnvironment({
        AIC_API_KEY_WORK: 'sk-profile',
        OPENAI_API_KEY: 'sk-provider',
        AIC_API_KEY: 'sk-generic',
    });

    it('should prefer cli api key over all other sources', () => {
        expect(
            resolveApiKey({
                provider: 'openai',
                profile: 'work',
                cliApiKey: 'sk-cli',
                profileApiKey: 'sk-yaml',
                env,
            }),
        ).toBe('sk-cli');
    });

    it('should prefer yaml api key over env vars', () => {
        expect(
            resolveApiKey({
                provider: 'openai',
                profile: 'work',
                profileApiKey: 'sk-yaml',
                env,
            }),
        ).toBe('sk-yaml');
    });

    it('should resolve from env when yaml and cli are missing', () => {
        expect(
            resolveApiKey({
                provider: 'openai',
                profile: 'work',
                env,
            }),
        ).toBe('sk-profile');
    });
});

describe('getApiKeyEnvVarCandidates', () => {
    it('should list profile, provider, and generic env vars', () => {
        expect(getApiKeyEnvVarCandidates('openai', 'work')).toEqual([
            'AIC_API_KEY_WORK',
            'OPENAI_API_KEY',
            'AIC_API_KEY',
        ]);
    });

    it('should return an empty list for providers without api keys', () => {
        expect(getApiKeyEnvVarCandidates('ollama', 'default')).toEqual([]);
    });
});
