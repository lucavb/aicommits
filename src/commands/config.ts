import { Argument, Command, Option } from '@commander-js/extra-typings';
import { configKeys } from '../utils/config';
import { runWithContainer } from '../utils/di';
import { ConfigSetHandler } from '../handlers/config-set.handler';

const configSetCommand = new Command('set')
    .description('Set a configuration property')
    .addOption(new Option('--profile <profile>', 'Configuration profile to use').default('default'))
    .addArgument(new Argument('name').choices(configKeys))
    .argument('<value>', 'Value of the configuration property')
    .action(async (name, value, { profile }) => {
        await runWithContainer({ cliArguments: { profile } }, (container) =>
            container.get(ConfigSetHandler).run({ name, value, profile }),
        );
    });

export const configCommand = new Command('config')
    .description('Manage configuration properties')
    .addCommand(configSetCommand);
