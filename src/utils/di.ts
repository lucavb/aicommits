import { Container } from 'inversify';

import { AICommitMessageService } from '../services/ai-commit-message.service';
import { ConfigService, FILE_SYSTEM_PROMISE_API } from '../services/config.service';
import { GitService } from '../services/git.service';
import { PromptService } from '../services/prompt.service';
import { promises as fs } from 'fs';
import { AIProvider, AIProviderSymbol } from '../services/ai-provider.interface';
import { OpenAIProvider } from '../services/openai-provider';
import { OllamaProvider } from '../services/ollama-provider';
import { AnthropicProvider } from '../services/anthropic-provider';

const container = new Container({ defaultScope: 'Singleton' });

// Bind services
container.bind(AICommitMessageService).toSelf();
container.bind(ConfigService).toSelf();
container.bind(GitService).toSelf();
container.bind(PromptService).toSelf();
container.bind(FILE_SYSTEM_PROMISE_API).toConstantValue(fs);

container
    .bind<AIProvider>(AIProviderSymbol)
    .toResolvedValue(
        (envService: ConfigService) => {
            const { provider, ...config } = envService.getConfig();

            switch (provider) {
                case 'openai': {
                    return OpenAIProvider.create({ baseUrl: config.baseUrl, apiKey: config.apiKey });
                }
                case 'ollama': {
                    return OllamaProvider.create({ baseUrl: config.baseUrl });
                }
                case 'anthropic': {
                    return AnthropicProvider.create({ baseUrl: config.baseUrl, apiKey: config.apiKey });
                }
            }
        },
        [ConfigService],
    )
    .inSingletonScope();

export { container };
