import { Container } from 'inversify';

import { AICommitMessageService, AI_MODEL_SYMBOL } from '../services/ai-commit-message.service';
import { ConfigService, FILE_SYSTEM_PROMISE_API } from '../services/config.service';
import { GitService } from '../services/git.service';
import { PromptService } from '../services/prompt.service';
import { ModelDiscoveryService } from '../services/model-discovery.service';
import { promises as fs } from 'fs';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOllama } from 'ollama-ai-provider';
import type { LanguageModelV1 } from 'ai';

const container = new Container({ defaultScope: 'Singleton' });

// Bind services
container.bind(AICommitMessageService).toSelf();
container.bind(ConfigService).toSelf();
container.bind(GitService).toSelf();
container.bind(PromptService).toSelf();
container.bind(ModelDiscoveryService).toSelf();

container.bind(FILE_SYSTEM_PROMISE_API).toConstantValue(fs);

function createAIModel(): LanguageModelV1 {
    const configService = container.get(ConfigService);
    const { provider, baseUrl, apiKey, model } = configService.getConfig();

    switch (provider) {
        case 'openai': {
            if (!apiKey) {
                throw new Error('OpenAI API key is required');
            }
            const openai = createOpenAI({ baseURL: baseUrl, apiKey });
            return openai(model);
        }
        case 'anthropic': {
            if (!apiKey) {
                throw new Error('Anthropic API key is required');
            }
            const anthropic = createAnthropic({ baseURL: baseUrl, apiKey });
            return anthropic(model);
        }
        case 'ollama': {
            const ollama = createOllama({ baseURL: baseUrl + '/api' });
            return ollama(model);
        }
        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

container
    .bind<LanguageModelV1>(AI_MODEL_SYMBOL)
    .toDynamicValue(() => createAIModel())
    .inSingletonScope();

export { container };
