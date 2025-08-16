import { Command, Option } from '@commander-js/extra-typings';
import { bgCyan, black, green, red, yellow } from 'kolorist';
import { handleCliError, KnownError } from '../utils/error';
import { isError } from '../utils/typeguards';
import { Container } from 'inversify';
import { AIAgentService } from '../services/ai-agent.service';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { AICommitSplittingService } from '../services/ai-commit-splitting.service';
import { GitService } from '../services/git.service';
import { ConfigService } from '../services/config.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { agentStreamingReviewAndRevise, handleCommitSplitting } from './aicommits-utils';
import { trimLines } from '../utils/string';
import { container } from '../utils/di';
import { CLI_ARGUMENTS } from '../services/config.service';
import { createPullRequest } from './pr';

export const aiCommitsAgent = async ({
    container,
    stageAll = false,
    profile = 'default',
    splitMode = false,
}: {
    container: Container;
    stageAll?: boolean;
    profile?: string;
    splitMode?: boolean;
}) => {
    const configService = container.get(ConfigService);
    const gitService = container.get(GitService);
    const aiAgentService = container.get(AIAgentService);
    const aiCommitMessageService = container.get(AICommitMessageService);
    const aiCommitSplittingService = container.get(AICommitSplittingService);
    const promptUI = container.get(ClackPromptService);

    try {
        await configService.readConfig();

        promptUI.intro(bgCyan(black(' aicommits agent ')));
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

        if (splitMode) {
            await handleSplitMode(aiCommitSplittingService, aiCommitMessageService, gitService, promptUI);
        } else {
            await handleAgentMode(aiAgentService, gitService, promptUI);
        }
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
    // Check if we have staged changes
    const hasStagedChanges = await gitService.hasStagedChanges();
    if (!hasStagedChanges) {
        throw new KnownError(
            trimLines(`
                No staged changes found. Stage your changes manually, or automatically stage all changes with the \`--stage-all\` flag.
            `),
        );
    }

    const analyzeSpinner = promptUI.spinner();
    analyzeSpinner.start('AI agent is analyzing the repository...');

    try {
        const result = await aiAgentService.generateCommitWithAgent({
            onToolCall: (message: string) => {
                analyzeSpinner.message(`AI agent: ${message}`);
            },
        });
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

const handleSplitMode = async (
    aiCommitSplittingService: AICommitSplittingService,
    aiCommitMessageService: AICommitMessageService,
    gitService: GitService,
    promptUI: ClackPromptService,
): Promise<void> => {
    // Check if we have staged changes
    const hasStagedChanges = await gitService.hasStagedChanges();
    if (!hasStagedChanges) {
        throw new KnownError(
            trimLines(`
                No staged changes found. Stage your changes manually, or automatically stage all changes with the \`--stage-all\` flag.
            `),
        );
    }

    const result = await handleCommitSplitting({
        aiCommitSplittingService,
        aiCommitMessageService,
        gitService,
        promptUI,
    });

    if (result.accepted && result.commitCount && result.commitCount > 0) {
        promptUI.outro(
            `${green('✔')} Successfully created ${result.commitCount} commit${result.commitCount > 1 ? 's' : ''} using AI-guided splitting`,
        );
    } else {
        promptUI.outro(`${red('✖')} No commits were created`);
    }
};

// PR subcommand
const prCommand = new Command('pr')
    .description('Create a GitHub Pull Request with AI-generated content')
    .addOption(new Option('--base <base>', 'Base branch for the PR (defaults to main/master)'))
    .addOption(new Option('--head <head>', 'Head branch for the PR (defaults to current branch)'))
    .addOption(new Option('--draft', 'Create a draft PR').default(false))
    .action(async (options) => {
        container.bind(CLI_ARGUMENTS).toConstantValue(options);
        await createPullRequest({
            container,
            base: options.base,
            head: options.head,
            draft: options.draft,
        });
    });

export const agentCommand = new Command('agent')
    .description('Enable AI agent mode for autonomous repository analysis')
    .addOption(new Option('--api-key <apiKey>', 'API key for the AI provider'))
    .addOption(new Option('--base-url <baseUrl>', 'Base URL for the AI provider API'))
    .addOption(new Option('--exclude <exclude>', 'Glob patterns to exclude files from commit analysis'))
    .addOption(new Option('--model <model>', 'AI model to use for generating commit messages'))
    .addOption(new Option('--profile <profile>', 'Configuration profile to use').default('default'))
    .addOption(
        new Option(
            '--split',
            'Enable AI-guided commit splitting mode to group related changes into separate commits',
        ).default(false),
    )
    .addOption(new Option('--stage-all', 'Stage all modified files before generating commit'))
    .addCommand(prCommand)
    .action(async (options) => {
        container.bind(CLI_ARGUMENTS).toConstantValue(options);
        await aiCommitsAgent({
            container,
            profile: options.profile,
            splitMode: options.split,
            stageAll: options.stageAll,
        });
    });
