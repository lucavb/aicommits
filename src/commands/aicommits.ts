import { bgCyan, black, green, red, yellow } from 'kolorist';
import { handleCliError, KnownError } from '../utils/error';
import { isError } from '../utils/typeguards';
import { Container } from 'inversify';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { AIAgentService } from '../services/ai-agent.service';
import { GitService } from '../services/git.service';
import { ConfigService } from '../services/config.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { streamingReviewAndRevise, agentStreamingReviewAndRevise } from './aicommits-utils';
import { trimLines } from '../utils/string';

export const aiCommits = async ({
    container,
    stageAll = false,
    profile = 'default',
    agentMode = false,
}: {
    container: Container;
    stageAll?: boolean;
    profile?: string;
    agentMode?: boolean;
}) => {
    const configService = container.get(ConfigService);
    const gitService = container.get(GitService);
    const aiCommitMessageService = container.get(AICommitMessageService);
    const promptUI = container.get(ClackPromptService);

    try {
        await configService.readConfig();

        const aiAgentService = container.get(AIAgentService);

        promptUI.intro(bgCyan(black(agentMode ? ' aicommits agent ' : ' aicommits ')));
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
        promptUI.note(
            trimLines(`
             Profile: ${yellow(profile)}
             Provider: ${yellow(config.provider)}
             Model: ${yellow(config.model)}
             Endpoint: ${yellow(config.baseUrl)}
            `),
        );

        await gitService.assertGitRepo();

        if (stageAll) {
            const stagingSpinner = promptUI.spinner();
            stagingSpinner.start('Staging all files');
            await gitService.stageAllFiles();
            stagingSpinner.stop('All files staged');
        }

        // Handle agent mode
        if (agentMode) {
            return await handleAgentMode(aiAgentService, gitService, promptUI);
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
                // Update spinner message with the growing message content
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

async function handleAgentMode(
    aiAgentService: AIAgentService,
    gitService: GitService,
    promptUI: ClackPromptService,
): Promise<void> {
    const analyzeSpinner = promptUI.spinner();
    analyzeSpinner.start('AI agent is analyzing the repository...');

    try {
        const result = await aiAgentService.generateCommitWithAgent();

        analyzeSpinner.stop('Repository analysis complete');

        // Display the generated commit message
        promptUI.log.step('Generated commit message:');
        promptUI.log.message(green(result.commitMessage));

        if (result.body) {
            promptUI.log.step('Commit body:');
            promptUI.log.message(result.body);
        }

        if (!result.commitMessage) {
            throw new KnownError('No commit message was generated by the agent. Try again.');
        }

        // Use the agent-specific review and revision flow
        const reviewResult = await agentStreamingReviewAndRevise({
            aiAgentService,
            promptUI,
            message: result.commitMessage,
            body: result.body || '',
        });

        if (!reviewResult?.accepted) {
            return;
        }

        const message = reviewResult.message ?? '';
        const body = reviewResult.body ?? '';

        const fullMessage = `${message}\n\n${body}`.trim();
        await gitService.commitChanges(fullMessage);

        promptUI.outro(`${green('✔')} Successfully committed with AI agent`);
    } catch (error) {
        analyzeSpinner.stop('Agent analysis failed');
        throw error;
    }
}
