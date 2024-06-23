import { Option, program } from '@commander-js/extra-typings';
import { configCommand } from './commands/config';
import { configSchema, readConfig } from './utils/config';
import { shake } from 'radash';
import { aiCommits } from './commands/aicommits';
import { prepareCommitMsgCommand } from './commands/prepare-commit-msg';

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
        const savedConfig = await readConfig();
        const rawConfig = {
            ...savedConfig,
            ...shake(options),
            exclude: [...(savedConfig.exclude ?? []), options.exclude].filter(
                (arg): arg is string => typeof arg === 'string',
            ),
        };
        const parseResult = configSchema.safeParse(rawConfig);
        if (parseResult.success) {
            await aiCommits(parseResult.data);
        } else {
            console.error(parseResult.error.errors);
        }
    });

program.parse(process.argv);
