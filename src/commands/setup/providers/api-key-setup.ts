import { type ClackPromptService } from '../../../services/clack-prompt.service';

export interface ApiKeySetupResult {
    apiKey: string;
    persistApiKey: boolean;
}

export async function collectApiKeyForSetup({
    promptUI,
    providerLabel,
    currentApiKey,
    resolvedApiKey,
    sourceEnvVar,
}: {
    promptUI: ClackPromptService;
    providerLabel: string;
    currentApiKey?: string;
    resolvedApiKey?: string;
    sourceEnvVar?: string;
}): Promise<ApiKeySetupResult | null> {
    if (resolvedApiKey && !currentApiKey?.trim()) {
        if (sourceEnvVar) {
            promptUI.note(`Using API key from ${sourceEnvVar}`);
        }

        return {
            apiKey: resolvedApiKey,
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
