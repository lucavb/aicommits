import { bgCyan, black, green, red, yellow } from 'kolorist';
import { handleCliError, KnownError } from '../utils/error';
import { isError } from '../utils/typeguards';
import { Container } from 'inversify';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { GitService } from '../services/git.service';
import { ConfigService } from '../services/config.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { streamingReviewAndRevise } from './aicommits-utils';
import { trimLines } from '../utils/string';

export const aiCommits = async ({
    container,
    stageAll = false,
    profile = 'default',
}: {
    container: Container;
    stageAll?: boolean;
    profile?: string;
}) => {
    const configService = container.get(ConfigService);
    const gitService = container.get(GitService);
    const aiCommitMessageService = container.get(AICommitMessageService);
    const promptUI = container.get(ClackPromptService);

    try {
        await configService.readConfig();

        promptUI.intro(bgCyan(black(' aicommits ')));
        const validResult = configService.validConfig();
        if (!validResult.valid) {
            promptUI.note(
                trimLines(`
                It looks like you haven't set up aicommits yet. Let's get you started!
                
                Run ${yellow('aicommits setup')} to configure your settings.
            `),
            );
            process.exit(1);
        }

        const currentProfile = configService.getProfile(profile);
        if (!currentProfile) {
            const config = configService.getProfileNames();
            promptUI.note(
                trimLines(`
                Profile "${profile}" not found. Available profiles: ${config.join(', ')}
                
                Run ${yellow('aicommits setup --profile ' + profile)} to create this profile.
            `),
            );
            process.exit(1);
        }

        const config = currentProfile;

        // Display provider and model information
        const endpointInfo =
            config.provider === 'bedrock'
                ? 'Endpoint: AWS Bedrock'
                : `Endpoint: ${yellow('baseUrl' in config ? config.baseUrl : 'N/A')}`;

        promptUI.note(
            trimLines(`
             Profile: ${yellow(profile)}
             Provider: ${yellow(config.provider)}
             Model: ${yellow(config.model)}
             ${endpointInfo}
            `),
        );

        await gitService.assertGitRepo();

        if (stageAll) {
            const stagingSpinner = promptUI.spinner();
            stagingSpinner.start('Staging all files');
            await gitService.stageAllFiles();
            stagingSpinner.stop('All files staged');
        }

        const detectingFiles = promptUI.spinner();
        detectingFiles.start('Detecting staged files');
        const staged = await gitService.getStagedDiff(config.exclude, config.contextLines);

        if (!staged) {
            detectingFiles.stop('Detecting staged files');
            throw new KnownError(
                trimLines(`
                    No staged changes found. Stage your changes manually, or automatically stage all changes with the \`--stage-all\` flag.
                `),
            );
        }

        detectingFiles.stop(
            `${gitService.getDetectedMessage(staged.files)}:\n${staged.files.map((file) => `     ${file}`).join('\n')}`,
        );

        const analyzeSpinner = promptUI.spinner();
        analyzeSpinner.start('The AI is analyzing your changes');

        let commitMessage = '';
        let commitBody = '';
        let messageBuffer = '';

        // Use streaming API to generate and display commit message in real-time
        await aiCommitMessageService.generateStreamingCommitMessage({
            diff: staged.diff,
            onMessageUpdate: (content) => {
                messageBuffer += content;
                const previewContent =
                    messageBuffer.length > 50 ? messageBuffer.substring(0, 47) + '...' : messageBuffer;
                analyzeSpinner.message(`Generating commit message: ${previewContent}`);
            },
            onBodyUpdate: () => {
                // Don't show body updates in real-time
            },
            onComplete: (message, body) => {
                commitMessage = message;
                commitBody = body;
            },
        });

        analyzeSpinner.stop('Commit message generated');

        // Display the full message after generation
        promptUI.log.step('Generated commit message:');
        promptUI.log.message(green(commitMessage));

        if (commitBody) {
            promptUI.log.step('Commit body:');
            promptUI.log.message(commitBody);
        }

        if (!commitMessage) {
            throw new KnownError('No commit message was generated. Try again.');
        }

        const result = await streamingReviewAndRevise({
            aiCommitMessageService,
            promptUI,
            message: commitMessage,
            body: commitBody,
            diff: staged.diff,
        });
        if (!result?.accepted) {
            return;
        }

        const message = result.message ?? '';
        const body = result.body ?? '';

        const fullMessage = `${message}\n\n${body}`.trim();
        await gitService.commitChanges(fullMessage);

        promptUI.outro(`${green('✔')} Successfully committed`);
    } catch (error) {
        if (isError(error)) {
            promptUI.outro(`${red('✖')} ${error.message}`);
        } else {
            promptUI.outro(`${red('✖')} An unknown error occurred`);
        }
        handleCliError(error);
        process.exit(1);
    }
};
