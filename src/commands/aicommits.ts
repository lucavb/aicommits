import { bgCyan, black, cyan, dim, green, red } from 'kolorist';
import { confirm, intro, isCancel, outro, select, spinner } from '@clack/prompts';
import { handleCliError, KnownError } from '../utils/error';
import { isError } from '../utils/typeguards';
import { Container } from 'inversify';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { GitService } from '../services/git.service';
import { ConfigService } from '../services/config.service';

const chooseOption = async (message: string, options: string[]): Promise<string | null> => {
    const selected = await select({
        message: `${message} ${dim('(Ctrl+c to exit)')}`,
        options: options.map((value, index) => ({ label: value, value: index })),
    });

    if (typeof selected !== 'number') {
        outro('Unable to understand the selected option');
        return null;
    }

    if (isCancel(selected)) {
        outro('Commit cancelled');
        return null;
    }

    return options[selected];
};

export const aiCommits = async ({ container, stageAll = false }: { container: Container; stageAll?: boolean }) => {
    try {
        const gitService = container.get(GitService);
        const aiCommitMessageService = container.get(AICommitMessageService);
        const config = await container.get(ConfigService).getConfig();
        intro(bgCyan(black(' aicommits ')));
        await gitService.assertGitRepo();

        if (stageAll) {
            const stagingSpinner = spinner();
            stagingSpinner.start('Staging all files');
            await gitService.stageAllFiles();
            stagingSpinner.stop('All files staged');
        }

        const detectingFiles = spinner();
        detectingFiles.start('Detecting staged files');
        const staged = await gitService.getStagedDiff(config.exclude, config.contextLines);

        if (!staged) {
            detectingFiles.stop('Detecting staged files');
            throw new KnownError(
                'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.',
            );
        }

        detectingFiles.stop(
            `${gitService.getDetectedMessage(staged.files)}:\n${staged.files.map((file) => `     ${file}`).join('\n')}`,
        );

        const s = spinner();
        s.start('The AI is analyzing your changes');
        const { commitMessages: messages, bodies: commitBodies } = await aiCommitMessageService.generateCommitMessage({
            diff: staged.diff,
        });

        s.stop('Changes analyzed');

        if (messages.length === 0) {
            throw new KnownError('No commit messages were generated. Try again.');
        }

        let message: string;
        let body: string;
        if (messages.length === 1 && commitBodies.length === 1) {
            [message] = messages;
            [body] = commitBodies;
            const confirmed = await confirm({
                message: `Use this commit message?\n\n${cyan(message)}\n\n${cyan(body)}\n`,
            });

            if (!confirmed || isCancel(confirmed)) {
                outro('Commit cancelled');
                return;
            }
        } else {
            message = (await chooseOption('Pick a commit message to use:', messages)) ?? '';
            if (!message) {
                return;
            }

            if (commitBodies.length > 0) {
                body = (await chooseOption('Pick a commit body to use:', commitBodies)) ?? '';
                if (!body) {
                    return;
                }
            } else {
                body = '';
            }
        }

        const fullMessage = `${message}\n\n${body}`.trim();
        await gitService.commitChanges(fullMessage);

        outro(`${green('✔')} Successfully committed`);
    } catch (error) {
        if (isError(error)) {
            outro(`${red('✖')} ${error.message}`);
        } else {
            outro(`${red('✖')} An unknown error occurred`);
        }
        handleCliError(error);
        process.exit(1);
    }
};
