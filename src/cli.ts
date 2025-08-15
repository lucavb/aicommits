import 'reflect-metadata';
import { Option, program } from '@commander-js/extra-typings';
import { aiCommits } from './commands/aicommits';
import { versionCommand } from './commands/version';
import { configCommand } from './commands/config';
import { setupCommand } from './commands/setup';
import { prepareCommitMsgCommand } from './commands/prepare-commit-msg';
import { ignoreCommand } from './commands/ignore';
import { container } from './utils/di';
import { CLI_ARGUMENTS } from './services/config.service';

program.addCommand(configCommand);
program.addCommand(setupCommand);
program.addCommand(prepareCommitMsgCommand);
program.addCommand(ignoreCommand);
program.addCommand(versionCommand);

program
    .passThroughOptions(true)
    .addOption(new Option('--api-key <apiKey>', 'API key for the AI provider'))
    .addOption(new Option('--base-url <baseUrl>', 'Base URL for the AI provider API'))
    .addOption(new Option('--context-lines <contextLines>', 'Number of context lines to include in diff (default: 10)'))
    .addOption(new Option('--exclude <exclude>', 'Glob patterns to exclude files from commit analysis'))
    .addOption(new Option('--locale <locale>', 'Language locale for commit messages (default: en)'))
    .addOption(new Option('--max-length <maxLength>', 'Maximum length of commit message (default: 50)'))
    .addOption(new Option('--model <model>', 'AI model to use for generating commit messages'))
    .addOption(new Option('--profile <profile>', 'Configuration profile to use').default('default'))
    .addOption(new Option('--stage-all', 'Stage all modified files before generating commit'))
    .addOption(new Option('--type <type>', 'Commit message format type (conventional or empty)'))
    .action(async (options) => {
        container.bind(CLI_ARGUMENTS).toConstantValue(options);
        await aiCommits({ container, stageAll: options.stageAll, profile: options.profile });
    });

program.parse(process.argv);
