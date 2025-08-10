import { promises as fs } from 'fs';
import { Container } from 'inversify';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import {
    CLI_ARGUMENTS,
    CONFIG_FILE_PATH,
    ConfigService,
    FILE_SYSTEM_PROMISE_API,
    ENVIRONMENT_VARIABLES,
} from './config.service';
import { Injectable } from '../utils/inversify';
import { Config, ProfileConfig } from '../utils/config';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

@Injectable()
class MockFsApi implements Partial<typeof fs> {
    readFile = vi.fn();
    writeFile = vi.fn();
}

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

        const container = new Container({ defaultScope: 'Singleton' });

        container.bind(CLI_ARGUMENTS).toConstantValue(mockCliArguments);
        container.bind(CONFIG_FILE_PATH).toConstantValue(tempFilePath);
        container.bind(ConfigService).toSelf();
        container.bind(FILE_SYSTEM_PROMISE_API).to(MockFsApi);
        container.bind(ENVIRONMENT_VARIABLES).toConstantValue({});

        configService = container.get(ConfigService);
        mockFsApi = container.get(FILE_SYSTEM_PROMISE_API);
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
            const container = new Container({ defaultScope: 'Singleton' });
            container.bind(CLI_ARGUMENTS).toConstantValue({ profile: 'cli-profile' });
            container.bind(CONFIG_FILE_PATH).toConstantValue(tempFilePath);
            container.bind(ConfigService).toSelf();
            container.bind(FILE_SYSTEM_PROMISE_API).to(MockFsApi);
            container.bind(ENVIRONMENT_VARIABLES).toConstantValue({ AIC_PROFILE: 'env-profile' });

            const configServiceWithCli = container.get(ConfigService);
            configServiceWithCli.updateConfigInMemory({ currentProfile: 'config-profile' });
            expect(configServiceWithCli.getCurrentProfile()).toBe('cli-profile');
        });

        it('should return AIC_PROFILE environment variable when CLI profile not provided', () => {
            // Create config service without CLI profile argument
            const container = new Container({ defaultScope: 'Singleton' });
            container.bind(CLI_ARGUMENTS).toConstantValue({});
            container.bind(CONFIG_FILE_PATH).toConstantValue(tempFilePath);
            container.bind(ConfigService).toSelf();
            container.bind(FILE_SYSTEM_PROMISE_API).to(MockFsApi);
            container.bind(ENVIRONMENT_VARIABLES).toConstantValue({ AIC_PROFILE: 'env-profile' });

            const configServiceWithoutCli = container.get(ConfigService);
            configServiceWithoutCli.updateConfigInMemory({ currentProfile: 'config-profile' });
            expect(configServiceWithoutCli.getCurrentProfile()).toBe('env-profile');
        });

        it('should return config currentProfile when neither CLI nor env var provided', async () => {
            // Set up a config file with currentProfile
            const configWithCurrentProfile = { currentProfile: 'config-profile', profiles: {} };
            const fileContents = yamlStringify(configWithCurrentProfile);

            // Create config service without CLI profile argument or env var
            const container = new Container({ defaultScope: 'Singleton' });
            container.bind(CLI_ARGUMENTS).toConstantValue({});
            container.bind(CONFIG_FILE_PATH).toConstantValue(tempFilePath);
            container.bind(ConfigService).toSelf();
            container.bind(FILE_SYSTEM_PROMISE_API).to(MockFsApi);
            container.bind(ENVIRONMENT_VARIABLES).toConstantValue({});

            const mockFs = container.get<MockFsApi>(FILE_SYSTEM_PROMISE_API);
            mockFs.readFile.mockResolvedValue(fileContents);

            const configServiceWithoutCli = container.get(ConfigService);
            await configServiceWithoutCli.readConfig();
            expect(configServiceWithoutCli.getCurrentProfile()).toBe('config-profile');
        });

        it('should return default when no profile is specified anywhere', () => {
            // Create config service without any profile configuration
            const container = new Container({ defaultScope: 'Singleton' });
            container.bind(CLI_ARGUMENTS).toConstantValue({});
            container.bind(CONFIG_FILE_PATH).toConstantValue(tempFilePath);
            container.bind(ConfigService).toSelf();
            container.bind(FILE_SYSTEM_PROMISE_API).to(MockFsApi);
            container.bind(ENVIRONMENT_VARIABLES).toConstantValue({});

            const configServiceWithoutCli = container.get(ConfigService);
            expect(configServiceWithoutCli.getCurrentProfile()).toBe('default');
        });

        it('should handle empty AIC_PROFILE environment variable', async () => {
            // Set up a config file with currentProfile
            const configWithCurrentProfile = { currentProfile: 'config-profile', profiles: {} };
            const fileContents = yamlStringify(configWithCurrentProfile);

            // Create config service without CLI profile argument
            const container = new Container({ defaultScope: 'Singleton' });
            container.bind(CLI_ARGUMENTS).toConstantValue({});
            container.bind(CONFIG_FILE_PATH).toConstantValue(tempFilePath);
            container.bind(ConfigService).toSelf();
            container.bind(FILE_SYSTEM_PROMISE_API).to(MockFsApi);
            container.bind(ENVIRONMENT_VARIABLES).toConstantValue({ AIC_PROFILE: '' });

            const mockFs = container.get<MockFsApi>(FILE_SYSTEM_PROMISE_API);
            mockFs.readFile.mockResolvedValue(fileContents);

            const configServiceWithoutCli = container.get(ConfigService);
            await configServiceWithoutCli.readConfig();
            // Empty string should fallback to config currentProfile
            expect(configServiceWithoutCli.getCurrentProfile()).toBe('config-profile');
        });
    });
});
