import { type ProfileConfig, ProviderName } from '../../utils/config';
import { ClackPromptService } from '../../services/clack-prompt.service';

/**
 * Prompt the user to select an AI provider
 */
export async function setupProvider(
    promptUI: ClackPromptService,
    currentConfig?: ProfileConfig,
): Promise<ProviderName | null> {
    const provider = await promptUI.select({
        message: 'Select your AI provider',
        options: [
            { value: 'openai', label: 'OpenAI (compatible)' },
            { value: 'anthropic', label: 'Anthropic' },
        ],
        initialValue: currentConfig?.provider ?? 'openai',
    });

    if (provider === null) {
        return null;
    }

    if (typeof provider !== 'string') {
        throw new Error(`Invalid provider type: ${typeof provider}`);
    }

    const trimmedProvider = provider.trim();
    if (!['openai', 'anthropic'].includes(trimmedProvider)) {
        throw new Error(`Invalid provider value: "${provider}"`);
    }

    return trimmedProvider as ProviderName;
}
