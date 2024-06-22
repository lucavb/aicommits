import { Argument, Command } from '@commander-js/extra-typings';
import { configKeys, readConfig, writeConfig } from '../utils/config';

const configSetCommand = new Command('set')
    .description('Set a configuration property')
    .addArgument(new Argument('name').choices(configKeys))
    .argument('<value>', 'Value of the configuration property')
    .action(async (name, value) => {
        const config = { ...(await readConfig()), [name]: JSON.parse(value) };
        await writeConfig(config);
        console.log(`Configuration property "${name}" set to "${value}".`);
    });

// Define the config command
export const configCommand = new Command('config')
    .description('Manage configuration properties')
    .addCommand(configSetCommand);
