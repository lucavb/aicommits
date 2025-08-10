import { Command } from '@commander-js/extra-typings';
import { container } from '../utils/di';
import { ConfigService } from '../services/config.service';
import { GitService } from '../services/git.service';
import { AICommitMessageService } from '../services/ai-commit-message.service';

export const prepareCommitMsgCommand = new Command('prepare-commit-msg')
    .description('Runs aicommits silently and returns the first proposed text')
    .action(async () => {
        const configService = container.get(ConfigService);
        const gitService = container.get(GitService);
        const aiCommitMessageService = container.get(AICommitMessageService);
        const config = configService.getConfig();
        const staged = await gitService.getStagedDiff(config.exclude, config.contextLines);

        if (!staged) {
            return;
        }

        const { commitMessage, body } = await aiCommitMessageService.generateCommitMessage({ diff: staged.diff });

        if (commitMessage && body) {
            const fullMessage = `${commitMessage}\n\n${body}`.trim();
            console.log(fullMessage);
        }
    });
