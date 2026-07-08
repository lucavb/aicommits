import { Command, Option } from '@commander-js/extra-typings';
import { runWithContainer } from '../../utils/di';
import { SetupHandler } from '../../handlers/setup.handler';

export const setupCommand = new Command('setup')
    .addOption(new Option('--profile <profile>', 'Configuration profile to use').default('default'))
    .description('Interactive setup for aicommits')
    .action(async ({ profile }) => {
        await runWithContainer({ cliArguments: { profile } }, (container) => container.get(SetupHandler).run(profile));
    });
