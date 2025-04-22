import { bgCyan, black, green, red } from 'kolorist';
import { intro, outro, spinner } from '@clack/prompts';
import { handleCliError, KnownError } from '../utils/error';
import { isError } from '../utils/typeguards';
import { Container } from 'inversify';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { GitService } from '../services/git.service';
import { ConfigService } from '../services/config.service';
import { chooseOption, reviewAndRevise } from './aicommits-utils';

export const aiCommits = async ({ container, stageAll = false }: { container: Container; stageAll?: boolean }) => {
    try {
        const gitService = container.get(GitService);
        const aiCommitMessageService = container.get(AICommitMessageService);
        const configService = container.get(ConfigService);
        intro(bgCyan(black(' aicommits ')));
        const validResult = await configService.validConfig();
        if (!validResult.valid) {
            outro(
                `${red('✖')} Your configuration is invalid. Please update your .aicommits.yaml file or pass the required options as CLI parameters.\n` +
                    (validResult.errors?.map((e) => `- ${e.path.join('.')}: ${e.message}`).join('\n') || ''),
            );
            process.exit(1);
        }
        const config = await configService.getConfig();
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
