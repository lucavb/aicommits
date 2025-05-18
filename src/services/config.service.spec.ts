import { promises as fs } from 'fs';
import { Container } from 'inversify';
import { stringify as yamlStringify } from 'yaml';
import { CLI_ARGUMENTS, CONFIG_FILE_PATH, ConfigService, FILE_SYSTEM_PROMISE_API } from './config.service';
import { Injectable } from '../utils/inversify';
import { Config } from '../utils/config';

@Injectable()
class MockFsApi implements Partial<typeof fs> {
    readFile = jest.fn();
    writeFile = jest.fn();
}

describe('ConfigService', () => {
    let configService: ConfigService;
    let mockFsApi: MockFsApi;
    let tempFilePath: string;
    const mockCliArguments: Partial<Config> = { baseUrl: 'https://api.ollama.local/v1' };
    const mockConfig: Partial<Config> = { model: 'llama3' };

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
        } catch (err) {
            // File might not exist, ignore the error
        }
    });

    describe('readConfig', () => {
        it('should read and parse the config file', async () => {
            const fileContents = yamlStringify(mockConfig);
            mockFsApi.readFile.mockResolvedValue(fileContents);

            const result = await configService.readConfig();

            expect(result).toEqual(mockConfig);
        });

        it('should return an empty object if reading the config file fails', async () => {
            const result = await configService.readConfig();

            expect(result).toEqual({});
        });
    });

    describe('writeConfig', () => {
        it('should write the config to the file', async () => {
            configService.updateConfigInMemory(mockConfig);
            await configService.flush();

            expect(mockFsApi.writeFile).toHaveBeenCalledWith(tempFilePath, yamlStringify(mockConfig), 'utf8');
            expect(mockFsApi.writeFile).toHaveBeenCalledTimes(1);
        });
    });

    describe('getConfig', () => {
        it('should merge and validate the config', async () => {
            const savedConfig: Partial<Config> = { model: 'llama3' };
            mockFsApi.readFile.mockResolvedValueOnce(yamlStringify(savedConfig));

            const result = await configService.getConfig();

            expect(result).toStrictEqual({
                ...mockCliArguments,
                ...savedConfig,
                contextLines: 10,
                exclude: [],
                generate: 1,
                locale: 'en',
                maxLength: 50,
                stageAll: false,
            });
        });
    });

    describe('validConfig', () => {
        it('should return { valid: true } for a valid config', async () => {
            const savedConfig = { model: 'llama3' } satisfies Partial<Config>;
            mockFsApi.readFile.mockResolvedValueOnce(yamlStringify(savedConfig));

            const result = await configService.validConfig();

            expect(result).toEqual({ valid: true });
        });

        it('should return { valid: false, errors } for an invalid config', async () => {
            // model is required, so omit it to make config invalid
            const invalidConfig = { model: undefined } satisfies Partial<Config>;
            mockFsApi.readFile.mockResolvedValueOnce(yamlStringify(invalidConfig));

            const result = await configService.validConfig();

            if (result.valid) {
                throw new Error();
            }
            expect(Array.isArray(result.errors)).toBe(true);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toHaveProperty('message');
        });
    });
});
