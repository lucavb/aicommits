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
            { value: 'ollama', label: 'Ollama' },
            { value: 'anthropic', label: 'Anthropic' },
        ],
        initialValue: currentConfig?.provider ?? 'openai',
    });

    if (provider === null) {
        return null;
    }

    if (typeof provider !== 'string' || !['openai', 'ollama', 'anthropic'].includes(provider)) {
        throw new Error('Invalid provider');
    }

    return provider as ProviderName;
}
