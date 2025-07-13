import { select, spinner, text } from '@clack/prompts';
import { type ProfileConfig, ProviderName } from '../../utils/config';
import { red } from 'kolorist';
import { ModelDiscoveryService } from '../../services/model-discovery.service';
import { container } from '../../utils/di';

/**
 * Get the base URL placeholder based on the provider
 */
export function getBaseUrlPlaceholder(provider: ProviderName): string {
    if (provider === 'openai') {
        return 'https://api.openai.com/v1';
    }
    if (provider === 'ollama') {
        return 'http://localhost:11434';
    }
    return 'https://api.anthropic.com';
}

/**
 * Get the base URL message based on the provider
 */
export function getBaseUrlMessage(provider: ProviderName): string {
    if (provider === 'openai') {
        return 'Enter the OpenAI API base URL';
    }
    if (provider === 'ollama') {
        return 'Enter the Ollama API base URL';
    }
    return 'Enter the Anthropic API base URL';
}

/**
 * Get the initial value for the base URL field
 */
export function getBaseUrlInitialValue(provider: ProviderName, currentConfig?: ProfileConfig): string {
    if (currentConfig?.baseUrl) {
        return currentConfig.baseUrl;
    }
    return getBaseUrlPlaceholder(provider);
}

/**
 * Setup the base URL, API key, and model
 */
export async function setupModel(provider: ProviderName, currentConfig?: ProfileConfig) {
    // 1. Get base URL
    const baseUrl = await text({
        message: getBaseUrlMessage(provider),
        placeholder: getBaseUrlPlaceholder(provider),
        initialValue: getBaseUrlInitialValue(provider, currentConfig),
        validate: (value) => {
            if (!value) {
                return 'Base URL is required';
            }
            try {
                new URL(value);
            } catch {
                return 'Invalid URL';
            }
            return undefined;
        },
    });

    if (baseUrl === null) {
        return { baseUrl: null, apiKey: undefined, model: null };
    }

    if (typeof baseUrl !== 'string') {
        throw new Error('Base URL is required');
    }

    // 2. Get API key (only for OpenAI and Anthropic)
    let apiKey: string | undefined;
    if (provider === 'ollama') {
        // Ollama doesn't require an API key
        apiKey = undefined;
    } else {
        // OpenAI and Anthropic require an API key
        const apiKeyInput = await text({
            message: `Enter your ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key`,
            placeholder: 'Your API key',
            initialValue: currentConfig?.apiKey,
            validate: (value) => {
                if (!value) {
                    return 'API key is required';
                }
                return undefined;
            },
        });

        if (apiKeyInput === null) {
            return { baseUrl, apiKey: undefined, model: null };
        }

        if (typeof apiKeyInput !== 'string') {
            throw new Error('API key is required');
        }

        apiKey = apiKeyInput.trim();
    }

    // 3. Get model using the new model discovery service
    const modelDiscoveryService = container.get(ModelDiscoveryService);
    const s = spinner();
    s.start(`Fetching available models from ${provider}...`);

    try {
        const discoveryResult = await modelDiscoveryService.discoverModels({
            provider,
            apiKey,
            baseUrl: baseUrl.trim(),
        });

        if (!discoveryResult.success) {
            s.stop(red(`Failed to fetch models: ${discoveryResult.error}`));
            return { baseUrl, apiKey, model: null };
        }

        if (discoveryResult.models.length === 0) {
            const noModelsMessage =
                provider === 'ollama'
                    ? 'No models found. Please pull a model first using `ollama pull <model>`'
                    : 'No models found for your credentials.';
            s.stop(red(noModelsMessage));
            return { baseUrl, apiKey, model: null };
        }

        // Filter OpenAI models to exclude non-GPT models for OpenAI's main API
        let filteredModels = discoveryResult.models;
        if (provider === 'openai' && baseUrl.trim() === 'https://api.openai.com/v1') {
            filteredModels = discoveryResult.models.filter((model) => {
                const id = model.id.toLowerCase();
                return (
                    id.includes('gpt') &&
                    !id.includes('dall-e') &&
                    !id.includes('audio') &&
                    !id.includes('tts') &&
                    !id.includes('transcribe') &&
                    !id.includes('search') &&
                    !id.includes('realtime') &&
                    !id.includes('image') &&
                    !id.includes('preview')
                );
            });

            if (filteredModels.length === 0) {
                s.stop(red('No GPT models found for your credentials.'));
                return { baseUrl, apiKey, model: null };
            }
        }

        const modelChoices = filteredModels.map((model) => ({
            value: model.id,
            label: model.name,
        }));

        s.stop('Models fetched.');

        const selectedModel = await select({
            message: `Select the ${provider} model to use`,
            options: modelChoices,
            initialValue:
                currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
                    ? currentConfig.model
                    : modelChoices[0].value,
        });

        if (typeof selectedModel !== 'string') {
            return { baseUrl, apiKey, model: null };
        }

        return { baseUrl: baseUrl.trim(), apiKey, model: selectedModel };
    } catch (error) {
        s.stop(red(`Failed to fetch models: ${error instanceof Error ? error.message : 'Unknown error'}`));
        return { baseUrl, apiKey, model: null };
    }
}
