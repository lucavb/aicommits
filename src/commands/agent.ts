import { Option, program } from '@commander-js/extra-typings';
import { aiCommits } from './aicommits';
import { container } from '../utils/di';
import { CLI_ARGUMENTS } from '../services/config.service';

export const agentCommand = program
    .command('agent')
    .description('Enable AI agent mode for autonomous repository analysis')
    .addOption(new Option('--api-key <apiKey>', 'API key for the AI provider'))
    .addOption(new Option('--base-url <baseUrl>', 'Base URL for the AI provider API'))
    .addOption(new Option('--exclude <exclude>', 'Glob patterns to exclude files from commit analysis'))
    .addOption(new Option('--model <model>', 'AI model to use for generating commit messages'))
    .addOption(new Option('--profile <profile>', 'Configuration profile to use').default('default'))
    .addOption(new Option('--stage-all', 'Stage all modified files before generating commit'))
    .action(async (options) => {
        container.bind(CLI_ARGUMENTS).toConstantValue(options);
        await aiCommits({
            agentMode: true,
            container,
            profile: options.profile,
            stageAll: options.stageAll,
        });
    });
