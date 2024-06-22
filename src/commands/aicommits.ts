import { execa } from 'execa';
import { bgCyan, black, dim, green, red } from 'kolorist';
import { confirm, intro, isCancel, outro, select, spinner } from '@clack/prompts';
import { assertGitRepo, getDetectedMessage, getStagedDiff } from '../utils/git.js';
import { generateCommitMessage } from '../utils/openai.js';
import { handleCliError, KnownError } from '../utils/error.js';
import { Config } from '../utils/config';

export const aiCommits = async (config: Config) => {
    (async () => {
        intro(bgCyan(black(' aicommits ')));
        await assertGitRepo();

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
        let messages: string[];
        try {
            messages = await generateCommitMessage({ ...config, diff: staged.diff });
        } finally {
            s.stop('Changes analyzed');
        }

        if (messages.length === 0) {
            throw new KnownError('No commit messages were generated. Try again.');
        }

        let message: string;
        if (messages.length === 1) {
            [message] = messages;
            const confirmed = await confirm({
                message: `Use this commit message?\n\n   ${message}\n`,
            });

            if (!confirmed || isCancel(confirmed)) {
                outro('Commit cancelled');
                return;
            }
        } else {
            const selected = await select({
                message: `Pick a commit message to use: ${dim('(Ctrl+c to exit)')}`,
                options: messages.map((value) => ({ label: value, value })),
            });

            if (typeof selected !== 'string') {
                outro('Unable to understand the selected option');
                return;
            }

            if (isCancel(selected)) {
                outro('Commit cancelled');
                return;
            }

            message = selected;
        }

        await execa('git', ['commit', '-m', message]);

        outro(`${green('✔')} Successfully committed!`);
    })().catch((error) => {
        outro(`${red('✖')} ${error.message}`);
        handleCliError(error);
        process.exit(1);
    });
};
