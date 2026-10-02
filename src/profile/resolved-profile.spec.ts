import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../utils/env';
import { KnownError } from '../utils/error';
import { type ConfigFile } from './config-file';
import {
    assertProfileEnvVarUniqueness,
    describeUnusableProfile,
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
            expect(resolved).toMatchObject({
                status: 'invalid',
                name: 'default',
                cause: 'profile',
                issues: [expect.stringContaining('useResponsesApi')],
            });
        });

        it('is invalid when a CLI override is invalid', () => {
            const resolved = resolveProfile({
                file: fileWith(),
                cliArguments: { locale: 'not-a-locale' },
                env: parseEnvironment({}),
            });
            expect(resolved).toMatchObject({ status: 'invalid', cause: 'command-line' });
        });

        it('blames the stored profile, not the overrides, when both are invalid', () => {
            const resolved = resolveProfile({
                file: fileWith({ profiles: { default: { ...openai, model: '' } } }),
                cliArguments: { locale: 'not-a-locale' },
                env: parseEnvironment({}),
            });
            expect(resolved).toMatchObject({ status: 'invalid', cause: 'profile' });
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

        it('drop duplicates, keeping the first occurrence', () => {
            const { exclude } = expectReady(
                resolveProfile({
                    file: fileWith({
                        globalIgnore: ['*.lock'],
                        profiles: { default: { ...openai, exclude: ['*.snap'] } },
                    }),
                    cliArguments: { exclude: ['*.lock', '*.snap', 'docs/**'] },
                    env: parseEnvironment({}),
                }),
            );
            expect(exclude).toEqual(['*.lock', '*.snap', 'docs/**']);
        });

        it('validate CLI excludes like stored ones', () => {
            const resolved = resolveProfile({
                file: fileWith(),
                cliArguments: { exclude: [''] },
                env: parseEnvironment({}),
            });
            expect(resolved).toMatchObject({
                status: 'invalid',
                cause: 'command-line',
                issues: [expect.stringContaining('exclude')],
            });
        });

        // Consent gate: without an explicit config entry, the built-in defaults are
        // NEITHER applied NOR persisted; interactive callers must prompt (see
        // aicommits.handler) and non-interactive callers must not hide anything.
        describe('never-set global ignore is consent-gated, so no defaults are injected', () => {
            it('reports globalIgnoreUnset and keeps the exclude list explicit-only', () => {
                const resolved = expectReady(
                    resolveProfile({ file: fileWith(), cliArguments: {}, env: parseEnvironment({}) }),
                );
                expect(resolved.exclude).toEqual([]);
                expect(resolved.globalIgnoreUnset).toBe(true);
            });

            it('merges only profile and CLI excludes when global ignore was never set', () => {
                const { exclude, globalIgnoreUnset } = expectReady(
                    resolveProfile({
                        file: fileWith({ profiles: { default: { ...openai, exclude: ['*.snap'] } } }),
                        cliArguments: { exclude: ['docs/**'] },
                        env: parseEnvironment({}),
                    }),
                );
                expect(exclude).toEqual(['*.snap', 'docs/**']);
                expect(globalIgnoreUnset).toBe(true);
            });

            it('respects an explicitly empty global ignore without flagging it unset', () => {
                const resolved = expectReady(
                    resolveProfile({
                        file: fileWith({ globalIgnore: [] }),
                        cliArguments: {},
                        env: parseEnvironment({}),
                    }),
                );
                expect(resolved.exclude).toEqual([]);
                expect(resolved.globalIgnoreUnset).toBe(false);
            });
        });
    });

    describe('credential', () => {
        it('comes from the profile-scoped env var when the profile stores no key', () => {
            const { credential } = expectReady(
                resolveProfile({
                    file: fileWith({ currentProfile: 'work', profiles: { work: openai } }),
                    cliArguments: {},
                    env: parseEnvironment({ AIC_API_KEY_work: 'sk-from-env' }),
                }),
            );
            expect(credential).toMatchObject({
                value: 'sk-from-env',
                source: { kind: 'environment', variable: 'AIC_API_KEY_work' },
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
                candidates: ['AIC_API_KEY_default', 'OPENAI_API_KEY', 'AIC_API_KEY'],
            });
        });
    });
});

describe('locateCredential', () => {
    const base = { profileName: 'work', provider: 'openai' } as const;

    it('derives a readable env var for plain alphanumeric profile names', () => {
        expect(getProfileApiKeyEnvVar('work')).toBe('AIC_API_KEY_work');
        expect(getProfileApiKeyEnvVar('workDev')).toBe('AIC_API_KEY_workDev');
    });

    it('escapes punctuation individually instead of collapsing it', () => {
        expect(getProfileApiKeyEnvVar('my-work')).toBe('AIC_API_KEY_myX2DXwork');
    });

    it('derives distinct env vars for punctuation-only distinct profile names', () => {
        // Regression: the old derivation collapsed every non-alphanumeric
        // character to '_', so all of these resolved to AIC_API_KEY_WORK_DEV
        // and one profile's credential could resolve for the other profile.
        const derived = [
            getProfileApiKeyEnvVar('work.dev'),
            getProfileApiKeyEnvVar('work-dev'),
            getProfileApiKeyEnvVar('work dev'),
            getProfileApiKeyEnvVar('work_dev'),
        ];
        expect(derived).toEqual([
            'AIC_API_KEY_workX2EXdev',
            'AIC_API_KEY_workX2DXdev',
            'AIC_API_KEY_workX20Xdev',
            'AIC_API_KEY_workX5FXdev',
        ]);
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

        it('stays silent for distinct names, since the derivation is injective', () => {
            // Because the derivation is injective, only the profile itself can
            // derive its env var; the guard is defense-in-depth for
            // persistence paths (1a986f2), not a source of rejections.
            expect(() =>
                assertProfileEnvVarUniqueness(['work.dev', 'work-dev', 'work dev', 'work_dev', 'aws', 'AWS'], 'AWS'),
            ).not.toThrow();
        });
    });

    it('follows --api-key > profile > AIC_API_KEY_<PROFILE> > provider env var > AIC_API_KEY', () => {
        const allEnv = { AIC_API_KEY_work: 'sk-profile-env', OPENAI_API_KEY: 'sk-provider', AIC_API_KEY: 'sk-generic' };

        expect(
            locateCredential({ ...base, cliApiKey: 'sk-cli', profileApiKey: 'sk-file', env: parseEnvironment(allEnv) })
                .value,
        ).toBe('sk-cli');
        expect(locateCredential({ ...base, profileApiKey: 'sk-file', env: parseEnvironment(allEnv) }).value).toBe(
            'sk-file',
        );
        expect(locateCredential({ ...base, env: parseEnvironment(allEnv) }).source).toEqual({
            kind: 'environment',
            variable: 'AIC_API_KEY_work',
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

    it('never resolves the derived env var of a differently-named sibling profile', () => {
        // Old derivation collapsed 'work.dev' and 'work-dev' onto
        // AIC_API_KEY_WORK_DEV. With the injective derivation the env var set
        // for 'work.dev' (AIC_API_KEY_workX2EXdev) must not resolve as the key
        // of profile 'work-dev'; the provider var is used instead.
        const credential = locateCredential({
            profileName: 'work-dev',
            provider: 'openai',
            env: parseEnvironment({
                AIC_API_KEY_workX2EXdev: 'sk-for-work-dev-dot',
                OPENAI_API_KEY: 'sk-provider-fallback',
            }),
        });
        expect(credential.value).toBe('sk-provider-fallback');
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
        ).toEqual(['AIC_API_KEY_work', 'ANTHROPIC_API_KEY', 'AIC_API_KEY']);
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
        expect(() =>
            requireReady({ status: 'invalid', name: 'work', cause: 'profile', issues: ['model: required'] }),
        ).toThrow(/model: required/);
    });
});

describe('describeUnusableProfile', () => {
    it('asks a new user to run setup when no profiles exist', () => {
        const text = describeUnusableProfile({ status: 'missing', name: 'default', available: [] }).join('\n');
        expect(text).toContain("haven't set up aicommits yet");
        expect(text).toContain('aicommits setup');
    });

    it('lists the available profiles and how to create the missing one', () => {
        const text = describeUnusableProfile({ status: 'missing', name: 'work', available: ['home'] }).join('\n');
        expect(text).toContain('Profile "work" not found. Available profiles: home');
        expect(text).toContain('aicommits setup --profile work');
    });

    it('sends the user to setup when the stored profile is invalid', () => {
        const text = describeUnusableProfile({
            status: 'invalid',
            name: 'work',
            cause: 'profile',
            issues: ['model: required'],
        }).join('\n');
        expect(text).toContain('Profile "work" is invalid');
        expect(text).toContain('model: required');
        expect(text).toContain('aicommits setup --profile work');
    });

    it('does not send the user to setup when only the command-line options are invalid', () => {
        const text = describeUnusableProfile({
            status: 'invalid',
            name: 'work',
            cause: 'command-line',
            issues: ['locale: invalid'],
        }).join('\n');
        expect(text).toContain('command-line options are invalid');
        expect(text).toContain('locale: invalid');
        expect(text).not.toContain('aicommits setup');
    });

    it('styles the commands with the given highlighter', () => {
        const text = describeUnusableProfile(
            { status: 'missing', name: 'work', available: ['home'] },
            (command) => `<${command}>`,
        ).join('\n');
        expect(text).toContain('<aicommits setup --profile work>');
    });
});
