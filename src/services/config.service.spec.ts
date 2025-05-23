import { promises as fs } from 'fs';
import { Container } from 'inversify';
import { stringify as yamlStringify } from 'yaml';
import { CLI_ARGUMENTS, CONFIG_FILE_PATH, ConfigService, FILE_SYSTEM_PROMISE_API } from './config.service';
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
    const mockCliArguments: Partial<ProfileConfig> & { profile?: string } = { baseUrl: 'https://api.ollama.local/v1' };
    const mockConfig: Partial<Config> = {
        profiles: {
            default: {
                model: 'llama3',
                baseUrl: 'https://api.ollama.local/v1',
                provider: 'ollama',
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
            const savedConfig: Partial<Config> = {
                profiles: {
                    default: {
                        model: 'llama3',
                        baseUrl: 'https://api.ollama.local/v1',
                        provider: 'ollama',
                        stageAll: false,
                        contextLines: 10,
                        locale: 'en',
                        maxLength: 50,
                    },
                },
                currentProfile: 'default',
            };
            configService.updateConfigInMemory(savedConfig);
            await configService.flush();

            expect(mockFsApi.writeFile).toHaveBeenCalledWith(tempFilePath, yamlStringify(savedConfig), 'utf8');
            expect(mockFsApi.writeFile).toHaveBeenCalledTimes(1);
        });
    });

    describe('validConfig', () => {
        it('should return valid for a valid config', () => {
            const savedConfig = {
                profiles: {
                    default: {
                        model: 'llama3',
                        baseUrl: 'https://api.ollama.local/v1',
                        provider: 'ollama',
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
                        baseUrl: 'https://api.ollama.local/v1',
                        provider: 'ollama',
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
});
