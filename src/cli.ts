import 'reflect-metadata';
import { Option, program } from '@commander-js/extra-typings';
import { aiCommits } from './commands/aicommits';
import { configCommand } from './commands/config';
import { prepareCommitMsgCommand } from './commands/prepare-commit-msg';
import { container } from './utils/di';
import { CLI_ARGUMENTS } from './services/config.service';

program.addCommand(configCommand);
program.addCommand(prepareCommitMsgCommand);

program
    .addOption(new Option('--api-key <apiKey>'))
    .addOption(new Option('--base-url <baseUrl>'))
    .addOption(new Option('--context-lines <contextLines>'))
    .addOption(new Option('--exclude <exclude>'))
    .addOption(new Option('--generate <generate>'))
    .addOption(new Option('--locale <locale>'))
    .addOption(new Option('--max-length <maxLength>'))
    .addOption(new Option('--model <model>'))
    .addOption(new Option('--stage-all'))
    .addOption(new Option('--type <type>'))
    .action(async (options) => {
        container.bind(CLI_ARGUMENTS).toConstantValue(options);
        await aiCommits({ container, stageAll: options.stageAll });
    });

program.parse(process.argv);
