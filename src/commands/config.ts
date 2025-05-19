import { Argument, Command, Option } from '@commander-js/extra-typings';
import { configKeys } from '../utils/config';
import { container } from '../utils/di';
import { ConfigService } from '../services/config.service';

const configSetCommand = new Command('set')
    .description('Set a configuration property')
    .addOption(new Option('--profile <profile>', 'Configuration profile to use').default('default'))
    .addArgument(new Argument('name').choices(configKeys))
    .argument('<value>', 'Value of the configuration property')
    .action(async (name, value, { profile }) => {
        const configService = container.get(ConfigService);
        await configService.readConfig();
        configService.updateProfileInMemory(profile, { [name]: value });
        await configService.flush();
        console.log(`Configuration property "${name}" set to "${value}" in profile "${profile}".`);
    });

export const configCommand = new Command('config')
    .description('Manage configuration properties')
    .addCommand(configSetCommand);
