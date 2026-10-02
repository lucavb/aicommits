import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type Credential, describeCredentialSource } from '../../../profile/resolved-profile';

export interface ApiKeySetupResult {
    apiKey: string;
    persistApiKey: boolean;
}

export async function collectApiKeyForSetup({
    promptUI,
    providerLabel,
    currentApiKey,
    credential,
}: {
    promptUI: ClackPromptService;
    providerLabel: string;
    currentApiKey?: string;
    credential: Credential;
}): Promise<ApiKeySetupResult | null> {
    // With no key stored in the profile, a key found elsewhere (env var or --api-key) is used without being saved.
    if (credential.value && credential.source && !currentApiKey?.trim()) {
        promptUI.note(`Using API key from ${describeCredentialSource(credential.source)}`);

        return {
            apiKey: credential.value,
            persistApiKey: false,
        };
    }

    const apiKeyInput = await promptUI.text({
        message: `Enter your ${providerLabel} API key`,
        placeholder: 'Your API key',
        initialValue: currentApiKey,
        validate: (value) => {
            if (!value) {
                return 'API key is required';
            }
            return undefined;
        },
    });

    if (apiKeyInput === null) {
        return null;
    }

    if (typeof apiKeyInput !== 'string') {
        throw new Error('API key is required');
    }

    return {
        apiKey: apiKeyInput.trim(),
        persistApiKey: true,
    };
}
