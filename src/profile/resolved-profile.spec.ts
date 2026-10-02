import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../utils/env';
import { KnownError } from '../utils/error';
import {
    type ConfigFile,
    DEFAULT_GLOBAL_IGNORE,
    getProfileApiKeyEnvVar,
    locateCredential,
    requireReady,
    resolveProfile,
    type ResolvedProfile,
} from './resolved-profile';

const openai = { provider: 'openai', model: 'gpt-4', baseUrl: 'https://api.openai.com/v1' } as const;
const ollama = { provider: 'ollama', model: 'llama3' } as const;

const fileWith = (overrides: Partial<ConfigFile> = {}): ConfigFile => ({
    currentProfile: 'default',
    profiles: { default: openai },
    ...overrides,
});

const expectReady = (resolved: ResolvedProfile) => {
    if (resolved.status !== 'ready') {
        throw new Error(`expected ready, got ${JSON.stringify(resolved)}`);
    }
    return resolved;
};

describe('resolveProfile', () => {
    describe('profile selection', () => {
        const file = fileWith({
            currentProfile: 'file',
            profiles: { cli: openai, env: openai, file: openai, default: openai },
        });

        it('prefers --profile over everything', () => {
            const resolved = resolveProfile({
                file,
                cliArguments: { profile: 'cli' },
                env: parseEnvironment({ AIC_PROFILE: 'env' }),
            });
            expect(resolved.name).toBe('cli');
        });

        it('uses AIC_PROFILE when --profile is absent', () => {
            const resolved = resolveProfile({ file, cliArguments: {}, env: parseEnvironment({ AIC_PROFILE: 'env' }) });
            expect(resolved.name).toBe('env');
        });

        it("uses the file's currentProfile when neither --profile nor AIC_PROFILE is set", () => {
            expect(resolveProfile({ file, cliArguments: {}, env: parseEnvironment({}) }).name).toBe('file');
        });

        it('treats an empty AIC_PROFILE as unset', () => {
            const resolved = resolveProfile({ file, cliArguments: {}, env: parseEnvironment({ AIC_PROFILE: '  ' }) });
            expect(resolved.name).toBe('file');
        });

        it('falls back to "default"', () => {
            const resolved = resolveProfile({
                file: { profiles: { default: openai } },
                cliArguments: {},
                env: parseEnvironment({}),
            });
            expect(resolved.name).toBe('default');
        });
    });

    describe('status', () => {
        it('is missing when the selected profile does not exist, listing the ones that do', () => {
            const resolved = resolveProfile({
                file: fileWith({ profiles: { work: openai, home: ollama } }),
                cliArguments: { profile: 'nope' },
                env: parseEnvironment({}),
            });
            expect(resolved).toEqual({ status: 'missing', name: 'nope', available: ['work', 'home'] });
        });

        it('is missing with no available profiles for a fresh install', () => {
            const resolved = resolveProfile({ file: { profiles: {} }, cliArguments: {}, env: parseEnvironment({}) });
            expect(resolved).toEqual({ status: 'missing', name: 'default', available: [] });
        });

        it('is invalid when the profile fails validation, with readable issues', () => {
            const resolved = resolveProfile({
                file: fileWith({ profiles: { default: { ...openai, useResponsesApi: 'true' as unknown as boolean } } }),
                cliArguments: {},
                env: parseEnvironment({}),
            });
            expect(resolved.status).toBe('invalid');
            expect(resolved).toMatchObject({ name: 'default', issues: [expect.stringContaining('useResponsesApi')] });
        });

        it('is invalid when a CLI override is invalid', () => {
            const resolved = resolveProfile({
                file: fileWith(),
                cliArguments: { locale: 'not-a-locale' },
                env: parseEnvironment({}),
            });
            expect(resolved.status).toBe('invalid');
        });

        it('is ready with schema defaults applied', () => {
            const { settings } = expectReady(
                resolveProfile({ file: fileWith(), cliArguments: {}, env: parseEnvironment({}) }),
            );
            expect(settings).toMatchObject({ ...openai, contextLines: 10, locale: 'en', maxLength: 50 });
        });
    });

    describe('command-line overrides', () => {
        it('apply on top of the stored profile', () => {
            const { settings } = expectReady(
                resolveProfile({
                    file: fileWith(),
                    cliArguments: {
                        model: 'gpt-5',
                        contextLines: 3,
                        maxLength: 72,
                        locale: 'de',
                        type: 'conventional',
                    },
                    env: parseEnvironment({}),
                }),
            );
            expect(settings).toMatchObject({
                model: 'gpt-5',
                contextLines: 3,
                maxLength: 72,
                locale: 'de',
                type: 'conventional',
            });
        });

        it('ignore undefined values', () => {
            const { settings } = expectReady(
                resolveProfile({
                    file: fileWith(),
                    cliArguments: { model: undefined, baseUrl: undefined },
                    env: parseEnvironment({}),
                }),
            );
            expect(settings.model).toBe('gpt-4');
        });

        it('keep the API key out of settings', () => {
            const resolved = expectReady(
                resolveProfile({
                    file: fileWith({ profiles: { default: { ...openai, apiKey: 'sk-file' } } }),
                    cliArguments: {},
                    env: parseEnvironment({}),
                }),
            );
            expect(resolved.settings).not.toHaveProperty('apiKey');
            expect(resolved.credential.value).toBe('sk-file');
        });
    });

    describe('excludes', () => {
        it('merge global ignore, profile excludes, and CLI excludes in that order', () => {
            const { exclude } = expectReady(
                resolveProfile({
                    file: fileWith({
                        globalIgnore: ['dist/**'],
                        profiles: { default: { ...openai, exclude: ['*.snap'] } },
                    }),
                    cliArguments: { exclude: ['docs/**'] },
                    env: parseEnvironment({}),
                }),
            );
            expect(exclude).toEqual(['dist/**', '*.snap', 'docs/**']);
        });

        it('use the built-in global ignore when the user never set one', () => {
            const { exclude } = expectReady(
                resolveProfile({ file: fileWith(), cliArguments: {}, env: parseEnvironment({}) }),
            );
            expect(exclude).toEqual([...DEFAULT_GLOBAL_IGNORE]);
        });

        it('respect an explicitly empty global ignore', () => {
            const { exclude } = expectReady(
                resolveProfile({ file: fileWith({ globalIgnore: [] }), cliArguments: {}, env: parseEnvironment({}) }),
            );
            expect(exclude).toEqual([]);
        });
    });

    describe('credential', () => {
        it('comes from the profile-scoped env var when the profile stores no key', () => {
            const { credential } = expectReady(
                resolveProfile({
                    file: fileWith({ currentProfile: 'work', profiles: { work: openai } }),
                    cliArguments: {},
                    env: parseEnvironment({ AIC_API_KEY_WORK: 'sk-from-env' }),
                }),
            );
            expect(credential).toMatchObject({
                value: 'sk-from-env',
                source: { kind: 'environment', variable: 'AIC_API_KEY_WORK' },
            });
        });

        it('prefers --api-key over the stored key', () => {
            const { credential } = expectReady(
                resolveProfile({
                    file: fileWith({ profiles: { default: { ...openai, apiKey: 'sk-file' } } }),
                    cliArguments: { apiKey: 'sk-cli' },
                    env: parseEnvironment({}),
                }),
            );
            expect(credential).toMatchObject({ value: 'sk-cli', source: { kind: 'cli' } });
        });

        it('is ready even when a required key is absent, so the caller decides', () => {
            const resolved = resolveProfile({ file: fileWith(), cliArguments: {}, env: parseEnvironment({}) });
            expect(expectReady(resolved).credential).toEqual({
                required: true,
                candidates: ['AIC_API_KEY_DEFAULT', 'OPENAI_API_KEY', 'AIC_API_KEY'],
            });
        });
    });
});

describe('locateCredential', () => {
    const base = { profileName: 'work', provider: 'openai' } as const;

    it('normalizes profile names into the profile-scoped env var', () => {
        expect(getProfileApiKeyEnvVar('work')).toBe('AIC_API_KEY_WORK');
        expect(getProfileApiKeyEnvVar('my-work')).toBe('AIC_API_KEY_MY_WORK');
    });

    it('follows --api-key > profile > AIC_API_KEY_<PROFILE> > provider env var > AIC_API_KEY', () => {
        const allEnv = { AIC_API_KEY_WORK: 'sk-profile-env', OPENAI_API_KEY: 'sk-provider', AIC_API_KEY: 'sk-generic' };

        expect(
            locateCredential({ ...base, cliApiKey: 'sk-cli', profileApiKey: 'sk-file', env: parseEnvironment(allEnv) })
                .value,
        ).toBe('sk-cli');
        expect(locateCredential({ ...base, profileApiKey: 'sk-file', env: parseEnvironment(allEnv) }).value).toBe(
            'sk-file',
        );
        expect(locateCredential({ ...base, env: parseEnvironment(allEnv) }).source).toEqual({
            kind: 'environment',
            variable: 'AIC_API_KEY_WORK',
        });
        expect(
            locateCredential({
                ...base,
                env: parseEnvironment({ OPENAI_API_KEY: 'sk-provider', AIC_API_KEY: 'sk-generic' }),
            }).source,
        ).toEqual({ kind: 'environment', variable: 'OPENAI_API_KEY' });
        expect(locateCredential({ ...base, env: parseEnvironment({ AIC_API_KEY: 'sk-generic' }) }).source).toEqual({
            kind: 'environment',
            variable: 'AIC_API_KEY',
        });
    });

    it('ignores whitespace-only keys', () => {
        const credential = locateCredential({
            ...base,
            cliApiKey: '  ',
            profileApiKey: ' ',
            env: parseEnvironment({ AIC_API_KEY: 'sk-generic' }),
        });
        expect(credential.value).toBe('sk-generic');
    });

    it('lists the provider-specific candidates', () => {
        expect(
            locateCredential({ profileName: 'work', provider: 'anthropic', env: parseEnvironment({}) }).candidates,
        ).toEqual(['AIC_API_KEY_WORK', 'ANTHROPIC_API_KEY', 'AIC_API_KEY']);
    });

    it.each(['bedrock', 'ollama'] as const)('reports that %s needs no key, ignoring env vars', (provider) => {
        expect(
            locateCredential({ profileName: 'work', provider, env: parseEnvironment({ AIC_API_KEY: 'sk-generic' }) }),
        ).toEqual({ required: false, candidates: [] });
    });
});

describe('requireReady', () => {
    it('returns a ready profile unchanged', () => {
        const resolved = resolveProfile({ file: fileWith(), cliArguments: {}, env: parseEnvironment({}) });
        expect(requireReady(resolved)).toBe(resolved);
    });

    it('throws a KnownError for a missing profile', () => {
        expect(() => requireReady({ status: 'missing', name: 'work', available: [] })).toThrow(KnownError);
    });

    it('throws a KnownError naming the issues for an invalid profile', () => {
        expect(() => requireReady({ status: 'invalid', name: 'work', issues: ['model: required'] })).toThrow(
            /model: required/,
        );
    });
});
