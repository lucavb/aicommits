import { green, yellow } from 'kolorist';
import { Inject, Injectable } from '../utils/inversify';
import { ConfigService } from '../services/config.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { setupProvider } from '../commands/setup/provider-setup';
import { setupModel } from '../commands/setup/model-setup';
import { setupCommitFormat } from '../commands/setup/format-setup';
import { setupLanguage } from '../commands/setup/language-setup';

@Injectable()
export class SetupHandler {
    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(ClackPromptService) private readonly promptUI: ClackPromptService,
    ) {}

    async run(profile: string): Promise<void> {
        const { configService, promptUI } = this;

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

        const modelSetupContext = {
            profile,
            resolveApiKey: (profileApiKey?: string) =>
                configService.resolveApiKeyFor({
                    profile,
                    provider,
                    profileApiKey,
                }),
            getApiKeySourceEnvVar: (profileApiKey?: string) =>
                configService.getApiKeySourceEnvVarFor({
                    profile,
                    provider,
                    profileApiKey,
                }),
        };

        // 2. Setup model
        const modelSetupResult = await setupModel(promptUI, provider, modelSetupContext, currentConfig);
        if (!modelSetupResult.model) {
            promptUI.outro('Setup cancelled');
            process.exit(0);
        }

        if (provider === 'bedrock') {
            configService.updateProfileInMemory(profile, { model: modelSetupResult.model });
        } else {
            if (!('baseUrl' in modelSetupResult) || !modelSetupResult.baseUrl || !modelSetupResult.model) {
                promptUI.outro('Setup cancelled');
                process.exit(0);
            }
            configService.updateProfileInMemory(profile, {
                baseUrl: modelSetupResult.baseUrl,
                model: modelSetupResult.model,
                ...(modelSetupResult.apiKey !== undefined && { apiKey: modelSetupResult.apiKey }),
                ...('useResponsesApi' in modelSetupResult &&
                    modelSetupResult.useResponsesApi !== undefined && {
                        useResponsesApi: modelSetupResult.useResponsesApi,
                    }),
            });
        }

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
    }
}
