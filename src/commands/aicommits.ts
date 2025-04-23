import { bgCyan, black, cyan, dim, green, red } from 'kolorist';
import { intro, isCancel, outro, select, spinner, text } from '@clack/prompts';
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

const reviewAndRevise = async (
    aiCommitMessageService: AICommitMessageService,
    message: string,
    body: string,
    diff: string,
): Promise<{ accepted: boolean; message?: string; body?: string }> => {
    let currentMessage = message;
    let currentBody = body;

    // Use a for loop with a maximum number of revisions to avoid infinite loops and lint errors.
    for (let i = 0; i < 10; i++) {
        const confirmed = await select({
            message: `Proposed commit message:\n\n${cyan(
                currentMessage,
            )}\n\n${cyan(currentBody)}\n\nWhat would you like to do?`,
            options: [
                { label: 'Accept and commit', value: 'accept' },
                { label: 'Revise with a prompt', value: 'revise' },
                { label: 'Cancel', value: 'cancel' },
            ],
        });

        if (confirmed === 'accept') {
            return { accepted: true, message: currentMessage, body: currentBody };
        }
        if (confirmed === 'cancel' || isCancel(confirmed)) {
            outro('Commit cancelled');
            return { accepted: false };
        }
        if (confirmed === 'revise') {
            const userPrompt = await text({
                message:
                    'Describe how you want to revise the commit message (e.g. "make it more descriptive", "use imperative mood", etc):',
                placeholder: 'Enter revision prompt',
            });
            if (!userPrompt || isCancel(userPrompt)) {
                outro('Commit cancelled');
                return { accepted: false };
            }
            const s = spinner();
            s.start('The AI is revising your commit message');
            const { commitMessages: revisedMessages, bodies: revisedBodies } =
                await aiCommitMessageService.reviseCommitMessage({ diff, userPrompt });
            s.stop('Revision complete');
            currentMessage = revisedMessages[0] ?? currentMessage;
            currentBody = revisedBodies[0] ?? currentBody;
        }
    }
    // If the user somehow exceeds the revision limit, cancel gracefully.
    outro('Too many revisions requested, commit cancelled.');
    return { accepted: false };
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
                'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--stage-all` flag.',
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
            const result = await reviewAndRevise(aiCommitMessageService, message, body, staged.diff);
            if (!result?.accepted) {
                return;
            }
            message = result.message ?? '';
            body = result.body ?? '';
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
            const result = await reviewAndRevise(aiCommitMessageService, message, body, staged.diff);
            if (!result?.accepted) {
                return;
            }
            message = result.message ?? '';
            body = result.body ?? '';
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
