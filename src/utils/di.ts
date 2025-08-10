import { Container } from 'inversify';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { ConfigService, FILE_SYSTEM_PROMISE_API, ENVIRONMENT_VARIABLES } from '../services/config.service';
import { GitService } from '../services/git.service';
import { PromptService } from '../services/prompt.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { AIProviderFactory } from '../services/ai-provider.factory';
import { AITextGenerationService } from '../services/ai-text-generation.service';
import { promises as fs } from 'fs';

const container = new Container({ defaultScope: 'Singleton' });

// Bind services
container.bind(AICommitMessageService).toSelf();
container.bind(ConfigService).toSelf();
container.bind(GitService).toSelf();
container.bind(PromptService).toSelf();
container.bind(ClackPromptService).toSelf();
container.bind(AIProviderFactory).toSelf();
container.bind(AITextGenerationService).toSelf();
container.bind(FILE_SYSTEM_PROMISE_API).toConstantValue(fs);
container.bind(ENVIRONMENT_VARIABLES).toConstantValue({
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    AIC_PROFILE: process.env.AIC_PROFILE,
});
export { container };
