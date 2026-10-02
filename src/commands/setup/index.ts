import { Command } from '@commander-js/extra-typings';
import { runWithContainer } from '../../utils/di';
import { SetupHandler } from '../../handlers/setup.handler';
import { profileOption } from '../profile-option';

export const setupCommand = new Command('setup')
    .addOption(profileOption())
    .description('Interactive setup for aicommits')
    .action(async ({ profile }) => {
        await runWithContainer({ cliArguments: { profile } }, (container) => container.get(SetupHandler).run());
    });
