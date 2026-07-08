import { promises as fs } from 'fs';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { ConfigService, type CliArguments } from './config.service';
import { Injectable } from '../utils/inversify';
import { buildContainer } from '../utils/di';
import { Config, ProfileConfig } from '../utils/config';
import { parseEnvironment, type Environment } from '../utils/env';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

@Injectable()
class MockFsApi implements Partial<typeof fs> {
    readFile = vi.fn();
    writeFile = vi.fn();
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
        it('should write the config to the file', async () => {
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

            expect(mockFsApi.writeFile).toHaveBeenCalledTimes(1);

            // Parse the written YAML and compare the object structure instead of string comparison
            const [filePath, yamlContent] = mockFsApi.writeFile.mock.calls[0];
            expect(filePath).toBe(tempFilePath);

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
                environment: parseEnvironment({ AIC_API_KEY_WORK: 'sk-from-env' }),
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
    });
});
