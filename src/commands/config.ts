import { Argument, Command } from '@commander-js/extra-typings';
import { configKeys } from '../utils/config';
import { runWithContainer } from '../utils/di';
import { ConfigSetHandler } from '../handlers/config-set.handler';
import { profileOption } from './profile-option';

const configSetCommand = new Command('set')
    .description('Set a configuration property')
    .addOption(profileOption())
    .addArgument(new Argument('name').choices(configKeys))
    .argument('<value>', 'Value of the configuration property')
    .action(async (name, value, { profile }) => {
        await runWithContainer({ cliArguments: { profile } }, (container) =>
            container.get(ConfigSetHandler).run({ name, value }),
        );
    });

export const configCommand = new Command('config')
    .description('Manage configuration properties')
    .addCommand(configSetCommand);
