import { describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';
import { AIProviderFactory } from './ai-provider.factory';
import { KnownError } from '../utils/error';
import { parseEnvironment } from '../utils/env';
import { buildContainer } from '../utils/di';

const containerWithFile = (file: unknown, env: Record<string, string> = {}) =>
    buildContainer({
        configFilePath: '/tmp/aicommits-test.yaml',
        environment: parseEnvironment(env),
        fileSystem: {
            readFile: async () => yamlStringify(file),
            writeFile: async () => undefined,
        },
    });

const workOpenAI = {
    currentProfile: 'work',
    profiles: { work: { model: 'gpt-4', baseUrl: 'https://api.openai.com/v1', provider: 'openai' } },
};

describe('AIProviderFactory', () => {
    it('throws a known error naming the env vars when the api key is missing for openai', async () => {
        const factory = (await containerWithFile(workOpenAI)).get(AIProviderFactory);

        expect(() => factory.createModel()).toThrow(KnownError);
        expect(() => factory.createModel()).toThrow('AIC_API_KEY_WORK');
        expect(() => factory.createModel()).toThrow('OPENAI_API_KEY');
    });

    it('creates a model with the located credential', async () => {
        const factory = (await containerWithFile(workOpenAI, { OPENAI_API_KEY: 'sk-env' })).get(AIProviderFactory);

        expect(factory.createModel()).toMatchObject({ modelId: 'gpt-4' });
    });

    it('creates an ollama model without any key', async () => {
        const factory = (
            await containerWithFile({ profiles: { default: { provider: 'ollama', model: 'llama3' } } })
        ).get(AIProviderFactory);

        expect(factory.createModel()).toMatchObject({ modelId: 'llama3' });
    });

    it('throws a known error instead of a ZodError when the profile is not usable', async () => {
        const factory = (await containerWithFile({ profiles: {} })).get(AIProviderFactory);

        expect(() => factory.createModel()).toThrow(KnownError);
        expect(() => factory.createModel()).toThrow('Profile "default" not found');
    });
});
