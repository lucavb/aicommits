import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './env';
import {
    assertProfileEnvVarUniqueness,
    getApiKeyEnvVarCandidates,
    getProfileApiKeyEnvVar,
    resolveApiKey,
    resolveApiKeyFromEnvironment,
} from './resolve-api-key';

describe('getProfileApiKeyEnvVar', () => {
    it('derives a readable env var for plain alphanumeric profile names', () => {
        expect(getProfileApiKeyEnvVar('work')).toBe('AIC_API_KEY_work');
        expect(getProfileApiKeyEnvVar('workDev')).toBe('AIC_API_KEY_workDev');
    });

    it('escapes punctuation individually instead of collapsing it', () => {
        expect(getProfileApiKeyEnvVar('my-work')).toBe('AIC_API_KEY_myX2DXwork');
    });
});

describe('getProfileApiKeyEnvVar injectivity', () => {
    it('derives distinct env vars for punctuation-only distinct profile names', () => {
        // Regression: the old derivation collapsed every non-alphanumeric
        // character to '_', so all of these resolved to AIC_API_KEY_WORK_DEV
        // and one profile's credential could resolve for the other profile.
        expect(getProfileApiKeyEnvVar('work.dev')).toBe('AIC_API_KEY_workX2EXdev');
        expect(getProfileApiKeyEnvVar('work-dev')).toBe('AIC_API_KEY_workX2DXdev');
        expect(getProfileApiKeyEnvVar('work dev')).toBe('AIC_API_KEY_workX20Xdev');
        expect(getProfileApiKeyEnvVar('work_dev')).toBe('AIC_API_KEY_workX5FXdev');
        const derived = [
            getProfileApiKeyEnvVar('work.dev'),
            getProfileApiKeyEnvVar('work-dev'),
            getProfileApiKeyEnvVar('work dev'),
            getProfileApiKeyEnvVar('work_dev'),
        ];
        expect(new Set(derived).size).toBe(4);
    });

    it('derives distinct env vars for case-only distinct profile names', () => {
        // Regression: old derivation upper-cased the name, so 'aws' and 'AWS'
        // shared one env var namespace
        expect(getProfileApiKeyEnvVar('aws')).toBe('AIC_API_KEY_aws');
        expect(getProfileApiKeyEnvVar('AWS')).toBe('AIC_API_KEY_AWS');
        expect(getProfileApiKeyEnvVar('aws')).not.toBe(getProfileApiKeyEnvVar('AWS'));
    });

    it('disambiguates characters that would be ambiguous with hex escapes', () => {
        // A literal uppercase X is escaped, so it cannot be confused with the
        // X<hex>X escape framing of a punctuation character
        expect(getProfileApiKeyEnvVar('X5FX')).toBe('AIC_API_KEY_X58X5FX58X');
        expect(getProfileApiKeyEnvVar('_')).toBe('AIC_API_KEY_X5FX');
        expect(getProfileApiKeyEnvVar('X5FX')).not.toBe(getProfileApiKeyEnvVar('_'));
    });
});

describe('assertProfileEnvVarUniqueness', () => {
    it('accepts the previously-colliding profile names now that the derivation is injective', () => {
        // Regression: these all shared AIC_API_KEY_WORK_DEV under the old
        // derivation; saving them together must no longer conflict
        const formerlyCollidingNames = ['work.dev', 'work-dev', 'work dev', 'work_dev', 'aws', 'AWS'];
        expect(() => assertProfileEnvVarUniqueness(formerlyCollidingNames, 'personal')).not.toThrow();
    });

    it('does not flag the profile against itself', () => {
        expect(() => assertProfileEnvVarUniqueness(['work-dev'], 'work-dev')).not.toThrow();
        expect(() => assertProfileEnvVarUniqueness([], 'work-dev')).not.toThrow();
    });
});

describe('resolveApiKeyFromEnvironment', () => {
    it('should prefer profile-scoped env vars over provider env vars', () => {
        const env = parseEnvironment({
            AIC_API_KEY_work: 'sk-profile',
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
        AIC_API_KEY_work: 'sk-profile',
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
            'AIC_API_KEY_work',
            'OPENAI_API_KEY',
            'AIC_API_KEY',
        ]);
    });

    it('should return an empty list for providers without api keys', () => {
        expect(getApiKeyEnvVarCandidates('ollama', 'default')).toEqual([]);
    });
});
