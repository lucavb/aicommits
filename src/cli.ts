import 'reflect-metadata';
import { InvalidArgumentError, Option, program } from '@commander-js/extra-typings';
import { AiCommitsHandler } from './handlers/aicommits.handler';
import { versionCommand } from './commands/version';
import { configCommand } from './commands/config';
import { setupCommand } from './commands/setup';
import { prepareCommitMsgCommand } from './commands/prepare-commit-msg';
import { ignoreCommand } from './commands/ignore';
import { runWithContainer } from './utils/di';

const parsePositiveInteger = (value: string): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new InvalidArgumentError('Must be a positive integer.');
    }
    return parsed;
};

const collectExcludePattern = (value: string, previous: string[]): string[] => previous.concat([value]);

program.addCommand(configCommand);
program.addCommand(setupCommand);
program.addCommand(prepareCommitMsgCommand);
program.addCommand(ignoreCommand);
program.addCommand(versionCommand);

program
    .passThroughOptions(true)
    .addOption(new Option('--api-key <apiKey>', 'API key for the AI provider'))
    .addOption(new Option('--base-url <baseUrl>', 'Base URL for the AI provider API'))
    .addOption(
        new Option(
            '--context-lines <contextLines>',
            'Number of context lines to include in diff (default: 10)',
        ).argParser(parsePositiveInteger),
    )
    .addOption(
        new Option(
            '--exclude <pattern>',
            'Glob pattern to exclude files from commit analysis (can be specified multiple times)',
        )
            .argParser(collectExcludePattern)
            .default([] as string[]),
    )
    .addOption(new Option('--locale <locale>', 'Language locale for commit messages (default: en)'))
    .addOption(
        new Option('--max-length <maxLength>', 'Maximum length of commit message (default: 50)').argParser(
            parsePositiveInteger,
        ),
    )
    .addOption(new Option('--model <model>', 'AI model to use for generating commit messages'))
    .addOption(new Option('--profile <profile>', 'Configuration profile to use').default('default'))
    .addOption(new Option('--stage-all', 'Stage all modified files before generating commit'))
    .addOption(new Option('--type <type>', 'Commit message format type (conventional or empty)'))
    .action(async (options) => {
        await runWithContainer({ cliArguments: options }, (container) =>
            container.get(AiCommitsHandler).run({ stageAll: options.stageAll }),
        );
    });

program.parse(process.argv);
