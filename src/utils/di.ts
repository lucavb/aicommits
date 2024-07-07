import { Container } from 'inversify';

import { AICommitMessageService } from '../services/ai-commit-message.service';
import { ConfigService, FILE_SYSTEM_PROMISE_API } from '../services/config.service';
import { GitService } from '../services/git.service';
import { PromptService } from '../services/prompt.service';
import { promises as fs } from 'fs';

const container = new Container({ defaultScope: 'Singleton' });
container.bind(AICommitMessageService).toSelf();
container.bind(ConfigService).toSelf();
container.bind(FILE_SYSTEM_PROMISE_API).toConstantValue(fs);
container.bind(GitService).toSelf();
container.bind(PromptService).toSelf();

export { container };
