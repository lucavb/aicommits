import { Command, Option } from '@commander-js/extra-typings';
import { container } from '../../utils/di';
import { ConfigService } from '../../services/config.service';
import { ClackPromptService } from '../../services/clack-prompt.service';
import { green, yellow } from 'kolorist';
import { setupProvider } from './provider-setup';
import { setupModel } from './model-setup';
import { setupCommitFormat } from './format-setup';
import { setupLanguage } from './language-setup';

export const setupCommand = new Command('setup')
    .addOption(new Option('--profile <profile>', 'Configuration profile to use').default('default'))
    .description('Interactive setup for aicommits')
    .action(async ({ profile }) => {
        const configService = container.get(ConfigService);
        const promptUI = container.get(ClackPromptService);

        promptUI.intro('Welcome to aicommits setup! 🚀');
        promptUI.note(`You are configuring the "${profile}" profile.`);

        await configService.readConfig();
        const currentConfig = configService.getRawProfile(profile);

        // 1. Setup provider
        const provider = await setupProvider(promptUI, currentConfig);
        if (provider === null) {
            promptUI.outro('Setup cancelled');
            process.exit(0);
        }
        configService.updateProfileInMemory(profile, { provider });

        // 2. Setup model
        const { baseUrl, apiKey, model } = await setupModel(promptUI, provider, currentConfig);
        if (!baseUrl || !model) {
            promptUI.outro('Setup cancelled');
            process.exit(0);
        }
        configService.updateProfileInMemory(profile, { baseUrl, apiKey, model });

        // 3. Setup commit message format
        const commitFormat = await setupCommitFormat(promptUI, currentConfig);
        if (commitFormat === null) {
            promptUI.outro('Setup cancelled');
            process.exit(0);
        }
        configService.updateProfileInMemory(profile, { type: commitFormat === 'simple' ? '' : 'conventional' });

        // 4. Setup language preference
        const locale = await setupLanguage(promptUI, currentConfig);
        if (locale === null) {
            promptUI.outro('Setup cancelled');
            process.exit(0);
        }
        configService.updateProfileInMemory(profile, { locale });

        // Save configuration
        await configService.flush();

        promptUI.note(
            `Configuration saved to ${yellow(configService.getConfigFilePath())}\n\n` +
                'You can now use aicommits! Try it with:\n' +
                `${green('git add .')}\n` +
                `${green('aicommits')}\n\n` +
                `To modify your settings later, run ${yellow('aicommits config set <key> <value>')}`,
        );

        promptUI.outro('Setup complete! 🎉');
    });
