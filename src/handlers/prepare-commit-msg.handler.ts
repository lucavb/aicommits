import { Inject, Injectable } from '../utils/inversify';
import { ConfigService } from '../services/config.service';
import { GitService } from '../services/git.service';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { buildCommitMessage } from '../services/proposal.service';

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

        const { subject, body } = await this.aiCommitMessageService.generate({
            diff: staged.diff,
        });

        if (subject && body) {
            const fullMessage = buildCommitMessage(subject, body);
            console.log(fullMessage);
        }
    }
}
