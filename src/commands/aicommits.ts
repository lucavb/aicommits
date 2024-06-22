import { bgCyan, black, dim, green, red, cyan } from 'kolorist';
import { confirm, intro, isCancel, outro, select, spinner } from '@clack/prompts';
import { assertGitRepo, commitChanges, getDetectedMessage, getStagedDiff, stageAllFiles } from '../utils/git';
import { generateCommitMessage } from '../utils/openai';
import { handleCliError, KnownError } from '../utils/error';
import { Config } from '../utils/config';

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

const isError = (error: unknown): error is Error => error instanceof Error;

export const aiCommits = async (config: Config) => {
    try {
        intro(bgCyan(black(' aicommits ')));
        await assertGitRepo();

        if (config.stageAll) {
            const stagingSpinner = spinner();
            stagingSpinner.start('Staging all files');
            await stageAllFiles();
            stagingSpinner.stop('All files staged');
        }

        const detectingFiles = spinner();
        detectingFiles.start('Detecting staged files');
        const staged = await getStagedDiff(config.exclude);

        if (!staged) {
            detectingFiles.stop('Detecting staged files');
            throw new KnownError(
                'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.',
            );
        }

        detectingFiles.stop(
            `${getDetectedMessage(staged.files)}:\n${staged.files.map((file) => `     ${file}`).join('\n')}`,
        );

        const s = spinner();
        s.start('The AI is analyzing your changes');
        const { commitMessages: messages, bodies: commitBodies } = await generateCommitMessage({
            ...config,
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
        await commitChanges(fullMessage);

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
