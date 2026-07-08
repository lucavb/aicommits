import { Container } from 'inversify';
import { describe, expect, it } from 'vitest';
import { AIProviderFactory } from './ai-provider.factory';
import {
    CLI_ARGUMENTS,
    CONFIG_FILE_PATH,
    ConfigService,
    ENVIRONMENT_VARIABLES,
    FILE_SYSTEM_PROMISE_API,
} from './config.service';
import { KnownError } from '../utils/error';
import { parseEnvironment } from '../utils/env';

describe('AIProviderFactory', () => {
    it('should throw a known error when api key is missing for openai', () => {
        const container = new Container({ defaultScope: 'Singleton' });
        container.bind(CLI_ARGUMENTS).toConstantValue({});
        container.bind(CONFIG_FILE_PATH).toConstantValue('/tmp/aicommits-test.yaml');
        container.bind(FILE_SYSTEM_PROMISE_API).toConstantValue({
            readFile: async () => {
                throw new Error('missing');
            },
            writeFile: async () => undefined,
        });
        container.bind(ENVIRONMENT_VARIABLES).toConstantValue(parseEnvironment({}));
        container.bind(ConfigService).toSelf();
        container.bind(AIProviderFactory).toSelf();

        const configService = container.get(ConfigService);
        configService.updateConfigInMemory({
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

        const factory = container.get(AIProviderFactory);

        expect(() => factory.createModel()).toThrow(KnownError);
        expect(() => factory.createModel()).toThrow('AIC_API_KEY_WORK');
        expect(() => factory.createModel()).toThrow('OPENAI_API_KEY');
    });
});
