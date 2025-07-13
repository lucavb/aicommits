import 'reflect-metadata';
import { Option, program } from '@commander-js/extra-typings';
import { aiCommits } from './commands/aicommits';
import { versionCommand } from './commands/version';
import { configCommand } from './commands/config';
import { setupCommand } from './commands/setup';
import { container } from './utils/di';

program.addCommand(configCommand);
program.addCommand(setupCommand);
program.addCommand(versionCommand);

program
    .passThroughOptions(true)
    .addOption(new Option('--api-key <apiKey>'))
    .addOption(new Option('--base-url <baseUrl>'))
    .addOption(new Option('--context-lines <contextLines>'))
    .addOption(new Option('--exclude <exclude>'))
    .addOption(new Option('--max-length <maxLength>'))
    .addOption(new Option('--model <model>'))
    .addOption(new Option('--profile <profile>'))
    .addOption(new Option('--provider <provider>'))
    .addOption(new Option('--stage-all'))
    .action(async (options) => {
        const profile = options.profile || 'default';
        const stageAll = options.stageAll || false;

        return await aiCommits({
            container,
            profile,
            stageAll,
            ...options,
        });
    });

program.parse();
