import { green, yellow } from 'kolorist';
import { Inject, Injectable } from '../utils/inversify';
import { ProfileStore } from '../profile/profile-store';
import { locateCredential, RESOLVED_PROFILE, type ResolvedProfile } from '../profile/resolved-profile';
import { ENVIRONMENT_VARIABLES, type Environment } from '../utils/env';
import { ClackPromptService } from '../services/clack-prompt.service';
import { assertProfileEnvVarUniqueness } from '../profile/resolved-profile';
import { setupProvider } from '../commands/setup/provider-setup';
import { setupModel } from '../commands/setup/model-setup';
import { setupCommitFormat } from '../commands/setup/format-setup';
import { setupLanguage } from '../commands/setup/language-setup';
import { type ModelSetupContext } from '../commands/setup/providers/types';

@Injectable()
export class SetupHandler {
    constructor(
        @Inject(ProfileStore) private readonly profileStore: ProfileStore,
        @Inject(RESOLVED_PROFILE) private readonly resolvedProfile: ResolvedProfile,
        @Inject(ENVIRONMENT_VARIABLES) private readonly env: Environment,
        @Inject(ClackPromptService) private readonly promptUI: ClackPromptService,
    ) {}

    async run(): Promise<void> {
        const { profileStore, promptUI } = this;
        // Setup works on the selected profile whether or not it is usable yet.
        const profile = this.resolvedProfile.name;

        promptUI.intro('Welcome to aicommits setup! 🚀');
        promptUI.note(`You are configuring the "${profile}" profile.`);

        // The derived API key env var must stay unique per profile - saving a
        // colliding profile would let one profile's credential resolve as the
        // other profile's key.
        assertProfileEnvVarUniqueness(profileStore.getProfileNames(), profile);

        const storedProfile = profileStore.getRawProfile(profile);

        // 1. Setup provider
        const provider = await setupProvider(promptUI, storedProfile);
        if (provider === null) {
            promptUI.outro('Setup cancelled');
            process.exit(0);
        }
        profileStore.updateProfile(profile, { provider });

        // The resolved profile located its credential for the provider stored before setup;
        // setup may switch providers, so it locates the credential again for the chosen one
        // (see docs/adr/0002). `setup` takes no --api-key, so the CLI is not a source here.
        const modelSetupContext: ModelSetupContext = {
            profile,
            locateCredential: (profileApiKey?: string) =>
                locateCredential({ profileName: profile, provider, profileApiKey, env: this.env }),
        };

        // 2. Setup model
        const modelSetupResult = await setupModel(promptUI, provider, modelSetupContext, storedProfile);
        if (!modelSetupResult.model) {
            promptUI.outro('Setup cancelled');
            process.exit(0);
        }

        if (provider === 'bedrock') {
            profileStore.updateProfile(profile, { model: modelSetupResult.model });
        } else {
            if (!('baseUrl' in modelSetupResult) || !modelSetupResult.baseUrl || !modelSetupResult.model) {
                promptUI.outro('Setup cancelled');
                process.exit(0);
            }
            profileStore.updateProfile(profile, {
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
        const commitFormat = await setupCommitFormat(promptUI, storedProfile);
        if (commitFormat === null) {
            promptUI.outro('Setup cancelled');
            process.exit(0);
        }
        profileStore.updateProfile(profile, { type: commitFormat === 'simple' ? '' : 'conventional' });

        // 4. Setup language preference
        const locale = await setupLanguage(promptUI, storedProfile);
        if (locale === null) {
            promptUI.outro('Setup cancelled');
            process.exit(0);
        }
        profileStore.updateProfile(profile, { locale });

        // Save configuration
        await profileStore.save();

        promptUI.note(
            `Configuration saved to ${yellow(profileStore.filePath)}\n\n` +
                'You can now use aicommits! Try it with:\n' +
                `${green('git add .')}\n` +
                `${green('aicommits')}\n\n` +
                `To modify your settings later, run ${yellow('aicommits config set <key> <value>')}`,
        );

        promptUI.outro('Setup complete! 🎉');
    }
}
