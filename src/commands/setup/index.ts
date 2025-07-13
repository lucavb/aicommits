import { cancel, intro, outro, spinner } from '@clack/prompts';
import { bgCyan, black, green, red, yellow } from 'kolorist';
import { Container } from 'inversify';
import { Command, Option } from '@commander-js/extra-typings';
import { ConfigService } from '../../services/config.service';
import { trimLines } from '../../utils/string';
import { handleCliError } from '../../utils/error';
import { setupProvider } from './provider-setup';
import { setupModel } from './model-setup';
import { container } from '../../utils/di';

const setupFunction = async ({ container, profile }: { container: Container; profile: string }) => {
    try {
        const configService = container.get(ConfigService);
        await configService.readConfig();

        intro(bgCyan(black(' aicommits setup ')));

        const currentConfig = configService.getProfile(profile);

        // 1. Setup provider
        const provider = await setupProvider(currentConfig);
        if (provider === null) {
            cancel('Setup cancelled');
            process.exit(0);
        }
        configService.updateProfileInMemory(profile, { provider });

        // 2. Setup model
        const modelResult = await setupModel(provider, currentConfig);
        if (modelResult === null) {
            cancel('Setup cancelled');
            process.exit(0);
        }
        configService.updateProfileInMemory(profile, {
            baseUrl: modelResult.baseUrl || undefined,
            apiKey: modelResult.apiKey,
            model: modelResult.model || undefined,
        });

        // 3. Save configuration
        const savingSpinner = spinner();
        savingSpinner.start('Saving configuration');
        await configService.flush();
        savingSpinner.stop('Configuration saved');

        outro(
            trimLines(`
                ${green('✔')} Setup complete!
                
                You can now use aicommits to generate commit messages.
                
                Run ${yellow('aicommits')} to generate a commit message for your staged changes.
                Run ${yellow('aicommits --help')} to see all available options.
            `),
        );
    } catch (error) {
        outro(`${red('✖')} Setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        handleCliError(error);
        process.exit(1);
    }
};

export const setupCommand = new Command('setup')
    .addOption(new Option('--profile <profile>', 'Configuration profile to use').default('default'))
    .description('Interactive setup for aicommits')
    .action(async ({ profile }) => {
        await setupFunction({ container, profile });
    });
