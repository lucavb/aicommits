import { Container } from 'inversify';
import { writeFileSync } from 'fs';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { GitService } from '../services/git.service';
import { ConfigService } from '../services/config.service';

export const prepareCommitMessage = async ({ container, file }: { container: Container; file: string }) => {
    try {
        const configService = container.get(ConfigService);
        await configService.readConfig();

        const gitService = container.get(GitService);
        const aiCommitMessageService = container.get(AICommitMessageService);

        const config = configService.getConfig();
        const staged = await gitService.getStagedDiff(config.exclude, config.contextLines);
        if (!staged) {
            return;
        }

        let commitMessage = '';
        let commitBody = '';

        // Use the agent pattern to generate commit message
        await aiCommitMessageService.generateAgentCommitMessage({
            stagedFiles: staged.files,
            onStepUpdate: () => {
                // Silent operation for prepare-commit-msg
            },
            onComplete: (message, body) => {
                commitMessage = message;
                commitBody = body;
            },
        });

        if (commitMessage) {
            const fullMessage = `${commitMessage}\n\n${commitBody}`.trim();
            writeFileSync(file, fullMessage);
        }
    } catch (error) {
        // Silent fail for prepare-commit-msg hook
        console.error('aicommits prepare-commit-msg failed:', error);
    }
};
