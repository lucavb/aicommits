import { Container } from 'inversify';

import { AICommitMessageService } from '../services/ai-commit-message.service';
import { ConfigService, FILE_SYSTEM_PROMISE_API } from '../services/config.service';
import { GitService } from '../services/git.service';
import { PromptService } from '../services/prompt.service';
import { promises as fs } from 'fs';
import { OpenAIProviderFactory } from '../services/openai-provider';
import type { AIProviderFactory } from '../services/ai-provider.interface';
import { AIProviderFactorySymbol } from '../services/ai-provider.interface';

const container = new Container({ defaultScope: 'Singleton' });

// Bind the default provider factory (OpenAI)
container.bind<AIProviderFactory>(AIProviderFactorySymbol).to(OpenAIProviderFactory);
container.bind(OpenAIProviderFactory).toSelf();

// Bind services
container.bind(AICommitMessageService).toSelf();
container.bind(ConfigService).toSelf();
container.bind(GitService).toSelf();
container.bind(PromptService).toSelf();
container.bind(FILE_SYSTEM_PROMISE_API).toConstantValue(fs);

export { container };
