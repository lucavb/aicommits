import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { ConfigService, type CliArguments } from './config.service';
import { Injectable } from '../utils/inversify';
import { buildContainer } from '../utils/di';
import { Config, ProfileConfig, profileConfigSchema } from '../utils/config';
import { parseEnvironment, type Environment } from '../utils/env';
import { KnownError } from '../utils/error';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

@Injectable()
class MockFsApi implements Partial<typeof fs> {
    readFile = vi.fn();
    writeFile = vi.fn();
    rename = vi.fn();
    chmod = vi.fn();
}

const createConfigService = (
    options: { cliArguments?: CliArguments; configFilePath?: string; environment?: Environment } = {},
) => {
    const fsApi = new MockFsApi();
    const container = buildContainer({
        cliArguments: options.cliArguments ?? {},
        configFilePath: options.configFilePath,
        environment: options.environment ?? parseEnvironment({}),
        fileSystem: fsApi,
    });

    return { configService: container.get(ConfigService), fsApi };
};

describe('ConfigService', () => {
    let configService: ConfigService;
    let mockFsApi: MockFsApi;
    let tempFilePath: string;
    const mockCliArguments: Partial<ProfileConfig> & { profile?: string } = { baseUrl: 'https://api.openai.com/v1' };
    const mockConfig: Partial<Config> = {
        profiles: {
            default: {
                model: 'gpt-4',
                baseUrl: 'https://api.openai.com/v1',
                provider: 'openai',
                stageAll: false,
                contextLines: 10,
                locale: 'en',
                maxLength: 50,
            },
        },
        currentProfile: 'default',
    };

    beforeEach(() => {
        tempFilePath = '/tmp/no-being-written.yaml';

        ({ configService, fsApi: mockFsApi } = createConfigService({
            cliArguments: mockCliArguments,
            configFilePath: tempFilePath,
        }));
    });

    afterEach(async () => {
        // Clean up the temporary file
        try {
            await fs.unlink(tempFilePath);
        } catch {
            // File might not exist, ignore the error
        }
    });

    describe('readConfig', () => {
        it('should read and parse the config file', async () => {
            const fileContents = yamlStringify(mockConfig);
            mockFsApi.readFile.mockResolvedValue(fileContents);

            await configService.readConfig();

            expect(configService.getConfig()).toMatchObject(mockConfig.profiles!.default);
        });
    });

    describe('writeConfig', () => {
        it('should write the config to the file atomically with owner-only mode', async () => {
            // Set up the complete config structure
            configService.updateConfigInMemory({ currentProfile: 'default' });
            configService.updateProfileInMemory('default', {
                baseUrl: 'https://api.openai.com/v1',
                contextLines: 10,
                locale: 'en',
                maxLength: 50,
                model: 'gpt-4',
                provider: 'openai',
                stageAll: false,
            });

            await configService.flush();

            // Atomic write: temp file first, chmod, then rename over the target
            expect(mockFsApi.writeFile).toHaveBeenCalledTimes(1);

            const [filePath, yamlContent, options] = mockFsApi.writeFile.mock.calls[0];
            expect(filePath).toBe(`${tempFilePath}.tmp`);
            expect(options).toEqual({ encoding: 'utf8', mode: 0o600 });

            expect(mockFsApi.chmod).toHaveBeenCalledWith(`${tempFilePath}.tmp`, 0o600);
            expect(mockFsApi.rename).toHaveBeenCalledWith(`${tempFilePath}.tmp`, tempFilePath);

            // Parse the written YAML and compare the object structure instead of string comparison
            const writtenConfig = yamlParse(yamlContent as string);
            expect(writtenConfig).toMatchObject({
                currentProfile: 'default',
                profiles: {
                    default: {
                        baseUrl: 'https://api.openai.com/v1',
                        contextLines: 10,
                        locale: 'en',
                        maxLength: 50,
                        model: 'gpt-4',
                        provider: 'openai',
                        stageAll: false,
                    },
                },
            });
        });
    });

    describe('readConfig failure handling', () => {
        const enoentError = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
        const eaccesError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });

        it('falls back to defaults only for a genuinely missing file', async () => {
            mockFsApi.readFile.mockRejectedValue(enoentError);

            await expect(configService.readConfig()).resolves.toBeUndefined();

            expect(configService.getProfileNames()).toEqual([]);
            expect(configService.getGlobalIgnorePatterns()).toEqual([]);
        });

        it('surfaces non-ENOENT read failures and never persists over the unreadable file', async () => {
            mockFsApi.readFile.mockRejectedValue(eaccesError);

            await expect(configService.readConfig()).rejects.toThrow(KnownError);

            // Simulate the ignore-add / config-set prelude: mutate, then flush
            configService.setGlobalIgnorePatterns(['*.log']);
            await expect(configService.flush()).rejects.toThrow('refusing to overwrite');

            expect(mockFsApi.writeFile).not.toHaveBeenCalled();
            expect(mockFsApi.rename).not.toHaveBeenCalled();
            expect(mockFsApi.chmod).not.toHaveBeenCalled();
        });

        it('surfaces corrupted YAML (truncated key-bearing config) instead of silently replacing it', async () => {
            // Truncated mid-document copy of a previously valid profile storing an apiKey:
            // yamlParse throws instead of yielding a profiles-shaped document
            const corruptedYaml = [
                'currentProfile: default',
                'profiles:',
                '  client:',
                '    provider: openai',
                '    baseUrl: https://api.openai.com/v1',
                '    model: gpt-4',
                '      apiKey: sk-STATIC-FAKE-DO-NOT-LOOK-UP',
            ].join('\n');
            mockFsApi.readFile.mockResolvedValue(corruptedYaml);

            await expect(configService.readConfig()).rejects.toThrow(KnownError);

            configService.setGlobalIgnorePatterns(['*.log']);
            await expect(configService.flush()).rejects.toThrow('could not be read or parsed');

            // The damaged file must not be overwritten with defaulted state
            expect(mockFsApi.writeFile).not.toHaveBeenCalled();
            expect(mockFsApi.rename).not.toHaveBeenCalled();
        });

        it('surfaces schema-invalid legacy flat configs (apiKey material) instead of defaulting them away', async () => {
            // Legacy flat document: parses as YAML but matches neither the
            // discriminated profile schema nor the profiles-shaped structure
            const legacyFlatYaml = ['apiKey: sk-legacy-STATIC-FAKE', 'baseUrl: https://api.openai.com/v1'].join('\n');
            mockFsApi.readFile.mockResolvedValue(legacyFlatYaml);

            await expect(configService.readConfig()).rejects.toThrow(KnownError);

            // Simulate the exact config-set prelude: the flush must refuse and
            // the legacy key material on disk must stay untouched
            configService.updateProfileInMemory('default', { model: 'gpt-4o-mini' });
            await expect(configService.flush()).rejects.toThrow('could not be read or parsed');

            expect(mockFsApi.writeFile).not.toHaveBeenCalled();
            expect(mockFsApi.rename).not.toHaveBeenCalled();
        });
    });

    describe('validConfig', () => {
        it('should return valid for a valid config', () => {
            const savedConfig = {
                profiles: {
                    default: {
                        model: 'gpt-4',
                        baseUrl: 'https://api.openai.com/v1',
                        provider: 'openai',
                        apiKey: 'test-api-key',
                        stageAll: false,
                        contextLines: 10,
                        locale: 'en',
                        maxLength: 50,
                    },
                },
                currentProfile: 'default',
            } satisfies Partial<Config>;
            configService.updateConfigInMemory(savedConfig);
            const result = configService.validConfig();
            expect(result.valid).toBe(true);
        });

        it('should return invalid for an invalid config', () => {
            const invalidConfig = {
                profiles: {
                    default: {
                        model: '',
                        baseUrl: 'https://api.openai.com/v1',
                        provider: 'openai',
                        stageAll: false,
                        contextLines: 10,
                        locale: 'en',
                        maxLength: 50,
                    },
                },
                currentProfile: 'default',
            } satisfies Partial<Config>;
            configService.updateConfigInMemory(invalidConfig);
            const result = configService.validConfig();
            expect(result.valid).toBe(false);
        });
    });

    describe('getCurrentProfile', () => {
        it('should return CLI profile when provided (highest precedence)', () => {
            // CLI argument should have highest precedence
            const { configService: configServiceWithCli } = createConfigService({
                cliArguments: { profile: 'cli-profile' },
                configFilePath: tempFilePath,
                environment: parseEnvironment({ AIC_PROFILE: 'env-profile' }),
            });

            configServiceWithCli.updateConfigInMemory({ currentProfile: 'config-profile' });
            expect(configServiceWithCli.getCurrentProfile()).toBe('cli-profile');
        });

        it('should return AIC_PROFILE environment variable when CLI profile not provided', () => {
            // Create config service without CLI profile argument
            const { configService: configServiceWithoutCli } = createConfigService({
                configFilePath: tempFilePath,
                environment: parseEnvironment({ AIC_PROFILE: 'env-profile' }),
            });

            configServiceWithoutCli.updateConfigInMemory({ currentProfile: 'config-profile' });
            expect(configServiceWithoutCli.getCurrentProfile()).toBe('env-profile');
        });

        it('should return config currentProfile when neither CLI nor env var provided', async () => {
            // Set up a config file with currentProfile
            const configWithCurrentProfile = { currentProfile: 'config-profile', profiles: {} };
            const fileContents = yamlStringify(configWithCurrentProfile);

            // Create config service without CLI profile argument or env var
            const { configService: configServiceWithoutCli, fsApi } = createConfigService({
                configFilePath: tempFilePath,
            });
            fsApi.readFile.mockResolvedValue(fileContents);

            await configServiceWithoutCli.readConfig();
            expect(configServiceWithoutCli.getCurrentProfile()).toBe('config-profile');
        });

        it('should return default when no profile is specified anywhere', () => {
            // Create config service without any profile configuration
            const { configService: configServiceWithoutCli } = createConfigService({
                configFilePath: tempFilePath,
            });

            expect(configServiceWithoutCli.getCurrentProfile()).toBe('default');
        });

        it('should handle empty AIC_PROFILE environment variable', async () => {
            // Set up a config file with currentProfile
            const configWithCurrentProfile = { currentProfile: 'config-profile', profiles: {} };
            const fileContents = yamlStringify(configWithCurrentProfile);

            // Create config service without CLI profile argument
            const { configService: configServiceWithoutCli, fsApi } = createConfigService({
                configFilePath: tempFilePath,
                environment: parseEnvironment({ AIC_PROFILE: '' }),
            });
            fsApi.readFile.mockResolvedValue(fileContents);

            await configServiceWithoutCli.readConfig();
            // Empty string should fallback to config currentProfile
            expect(configServiceWithoutCli.getCurrentProfile()).toBe('config-profile');
        });
    });

    describe('api key resolution', () => {
        it('should resolve api key from profile env var when yaml has no key', () => {
            const { configService: service } = createConfigService({
                configFilePath: tempFilePath,
                environment: parseEnvironment({ AIC_API_KEY_work: 'sk-from-env' }),
            });

            service.updateConfigInMemory({
                currentProfile: 'work',
                profiles: {
                    work: {
                        model: 'gpt-4',
                        baseUrl: 'https://api.openai.com/v1',
                        provider: 'openai',
                        stageAll: false,
                        contextLines: 10,
                        locale: 'en',
                        maxLength: 50,
                    },
                },
            });

            const config = service.getConfig();
            expect(config.provider).toBe('openai');
            if (config.provider === 'openai') {
                expect(config.apiKey).toBe('sk-from-env');
            }
        });

        it('should prefer yaml api key over env vars', () => {
            const { configService: service } = createConfigService({
                configFilePath: tempFilePath,
                environment: parseEnvironment({ OPENAI_API_KEY: 'sk-from-env' }),
            });

            service.updateConfigInMemory({
                currentProfile: 'default',
                profiles: {
                    default: {
                        model: 'gpt-4',
                        baseUrl: 'https://api.openai.com/v1',
                        provider: 'openai',
                        apiKey: 'sk-from-yaml',
                        stageAll: false,
                        contextLines: 10,
                        locale: 'en',
                        maxLength: 50,
                    },
                },
            });

            const config = service.getConfig();
            expect(config.provider).toBe('openai');
            if (config.provider === 'openai') {
                expect(config.apiKey).toBe('sk-from-yaml');
            }
        });

        it('keeps the yaml api key even when the derived profile env var is set', () => {
            const { configService: service } = createConfigService({
                configFilePath: tempFilePath,
                environment: parseEnvironment({ AIC_API_KEY_workX2DXdev: 'sk-from-env' }),
            });

            service.updateConfigInMemory({
                currentProfile: 'work-dev',
                profiles: {
                    'work-dev': {
                        model: 'gpt-4',
                        baseUrl: 'https://api.openai.com/v1',
                        provider: 'openai',
                        apiKey: 'sk-yaml-local',
                        stageAll: false,
                        contextLines: 10,
                        locale: 'en',
                        maxLength: 50,
                    },
                },
            });

            const config = service.getConfig();
            expect(config.provider).toBe('openai');
            if (config.provider === 'openai') {
                expect(config.apiKey).toBe('sk-yaml-local');
            }
        });

        it('never resolves the env var derived from a differently-named collision-profile', () => {
            // Old derivation collapsed 'work.dev' and 'work-dev' onto
            // AIC_API_KEY_WORK_DEV. With the injective derivation the env var
            // set for 'work.dev' (AIC_API_KEY_workX2EXdev) must not resolve as
            // the key of profile 'work-dev'; the provider var is used instead.
            const { configService: service } = createConfigService({
                configFilePath: tempFilePath,
                environment: parseEnvironment({
                    AIC_API_KEY_workX2EXdev: 'sk-for-work-dev-dot',
                    OPENAI_API_KEY: 'sk-provider-fallback',
                }),
            });

            service.updateConfigInMemory({
                currentProfile: 'work-dev',
                profiles: {
                    'work-dev': {
                        model: 'gpt-4',
                        baseUrl: 'https://api.openai.com/v1',
                        provider: 'openai',
                        stageAll: false,
                        contextLines: 10,
                        locale: 'en',
                        maxLength: 50,
                    },
                },
            });

            const config = service.getConfig();
            expect(config.provider).toBe('openai');
            if (config.provider === 'openai') {
                expect(config.apiKey).toBe('sk-provider-fallback');
            }
        });
    });

    describe('flush file mode', () => {
        const validOpenaiProfile = {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4',
            apiKey: 'sk-yaml-local',
        } as const;

        it('creates a first-time credential file with owner-only mode regardless of umask', async () => {
            const scratchDir = await fs.mkdtemp(join(tmpdir(), 'aicommits-mode-'));
            const configPath = join(scratchDir, 'config.yaml');
            const previousUmask = process.umask(0o022);
            try {
                const container = buildContainer({
                    configFilePath: configPath,
                    environment: parseEnvironment({}),
                });
                const service = container.get(ConfigService);

                service.updateConfigInMemory({ currentProfile: 'default' });
                service.updateProfileInMemory('default', { ...validOpenaiProfile });

                await service.flush();

                const stat = await fs.stat(configPath);
                expect(stat.mode & 0o777).toBe(0o600);
            } finally {
                process.umask(previousUmask);
                await fs.rm(scratchDir, { recursive: true, force: true });
            }
        });

        it('tightens a pre-existing permissive credential file back to owner-only mode', async () => {
            const scratchDir = await fs.mkdtemp(join(tmpdir(), 'aicommits-mode-'));
            const configPath = join(scratchDir, 'config.yaml');
            const previousUmask = process.umask(0o022);
            try {
                const existingConfig = yamlStringify({
                    currentProfile: 'default',
                    profiles: { default: validOpenaiProfile },
                });
                // Simulate the legacy permissive file: created before this fix,
                // e.g. 0o644 under the common umask 022
                await fs.writeFile(configPath, existingConfig, { encoding: 'utf8', mode: 0o644 });
                expect((await fs.stat(configPath)).mode & 0o777).toBe(0o644);

                const container = buildContainer({
                    configFilePath: configPath,
                    environment: parseEnvironment({}),
                });
                const service = container.get(ConfigService);

                await service.readConfig();
                service.updateProfileInMemory('default', { model: 'gpt-4o-mini' });
                await service.flush();

                // The atomic rename swaps in the fresh owner-only inode while
                // preserving the on-disk key material
                const stat = await fs.stat(configPath);
                expect(stat.mode & 0o777).toBe(0o600);
                const rewritten = yamlParse(await fs.readFile(configPath, 'utf8')) as {
                    profiles: Record<string, { apiKey?: string }>;
                };
                expect(rewritten.profiles.default.apiKey).toBe('sk-yaml-local');
            } finally {
                process.umask(previousUmask);
                await fs.rm(scratchDir, { recursive: true, force: true });
            }
        });
    });

    describe('profileConfigSchema reasoningEffort', () => {
        it('should parse an openai config with reasoningEffort', () => {
            const result = profileConfigSchema.safeParse({
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-5',
                reasoningEffort: 'high',
            });

            expect(result.success).toBe(true);
        });

        it('should parse an openai config with an empty reasoningEffort', () => {
            const result = profileConfigSchema.safeParse({
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-5',
                reasoningEffort: '',
            });

            expect(result.success).toBe(true);
        });

        it('should reject an invalid reasoningEffort', () => {
            const result = profileConfigSchema.safeParse({
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-5',
                reasoningEffort: 'ultra',
            });

            expect(result.success).toBe(false);
        });

        it('should parse an openrouter config with reasoningEffort', () => {
            const result = profileConfigSchema.safeParse({
                provider: 'openrouter',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'x',
                reasoningEffort: 'low',
            });

            expect(result.success).toBe(true);
        });

        it('should parse an openrouter config with an empty reasoningEffort', () => {
            const result = profileConfigSchema.safeParse({
                provider: 'openrouter',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'x',
                reasoningEffort: '',
            });

            expect(result.success).toBe(true);
        });
    });
});
