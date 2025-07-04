import { select } from '@clack/prompts';
import { type ProfileConfig, ProviderName } from '../../utils/config';

/**
 * Prompt the user to select an AI provider
 */
export async function setupProvider(currentConfig?: ProfileConfig): Promise<ProviderName | null> {
    const provider = await select({
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
