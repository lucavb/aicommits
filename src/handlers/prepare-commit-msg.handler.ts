import { Inject, Injectable } from '../utils/inversify';
import { ConfigService } from '../services/config.service';
import { GitService } from '../services/git.service';
import { AICommitMessageService } from '../services/ai-commit-message.service';

@Injectable()
export class PrepareCommitMsgHandler {
    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(GitService) private readonly gitService: GitService,
        @Inject(AICommitMessageService) private readonly aiCommitMessageService: AICommitMessageService,
    ) {}

    async run(): Promise<void> {
        const config = this.configService.getConfig();
        const staged = await this.gitService.getStagedDiff(config.exclude, config.contextLines);

        if (!staged) {
            return;
        }

        const { commitMessage, body } = await this.aiCommitMessageService.generateCommitMessage({
            diff: staged.diff,
        });

        if (commitMessage && body) {
            const fullMessage = `${commitMessage}\n\n${body}`.trim();
            console.log(fullMessage);
        }
    }
}
