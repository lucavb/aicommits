import { Argument, Command } from '@commander-js/extra-typings';
import { configKeys } from '../utils/config';
import { container } from '../utils/di';
import { ConfigService } from '../services/config.service';

const configSetCommand = new Command('set')
    .description('Set a configuration property')
    .addArgument(new Argument('name').choices(configKeys))
    .argument('<value>', 'Value of the configuration property')
    .action(async (name, value) => {
        const configService = container.get(ConfigService);

        const config = { ...(await configService.readConfig()), [name]: value };
        await configService.writeConfig(config);
        console.log(`Configuration property "${name}" set to "${value}".`);
    });

export const configCommand = new Command('config')
    .description('Manage configuration properties')
    .addCommand(configSetCommand);
