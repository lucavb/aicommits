import { describe, expect, it } from 'vitest';
import { AIProviderFactory } from './ai-provider.factory';
import { ConfigService } from './config.service';
import { KnownError } from '../utils/error';
import { parseEnvironment } from '../utils/env';
import { buildContainer } from '../utils/di';

describe('AIProviderFactory', () => {
    it('should throw a known error when api key is missing for openai', () => {
        const container = buildContainer({
            configFilePath: '/tmp/aicommits-test.yaml',
            environment: parseEnvironment({}),
            fileSystem: {
                readFile: async () => {
                    throw new Error('missing');
                },
                writeFile: async () => undefined,
            },
        });

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
