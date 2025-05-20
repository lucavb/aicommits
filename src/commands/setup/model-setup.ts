import { select, spinner, text } from '@clack/prompts';
import { type ProfileConfig, ProviderName } from '../../utils/config';
import { red } from 'kolorist';
import OpenAI from 'openai';
import { OllamaProvider } from '../../services/ollama-provider';
import Anthropic from '@anthropic-ai/sdk';

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

    // 3. Get model
    let model: string;
    if (provider === 'ollama') {
        // For Ollama, fetch available models
        const s = spinner();
        s.start('Fetching available models from Ollama...');
        try {
            const ollamaProvider = new OllamaProvider(fetch, baseUrl.trim());
            const models = await ollamaProvider.listModels();
            const modelChoices = models.map((name: string) => ({
                value: name,
                label: name,
            }));

            if (modelChoices.length === 0) {
                s.stop(red('No models found. Please pull a model first using `ollama pull <model>`'));
                return { baseUrl, apiKey, model: null };
            }

            s.stop('Models fetched.');

            const selectedModel = await select({
                message: 'Select the Ollama model to use',
                options: modelChoices,
                initialValue:
                    currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
                        ? currentConfig.model
                        : modelChoices[0].value,
            });

            if (typeof selectedModel !== 'string') {
                return { baseUrl, apiKey, model: null };
            }

            model = selectedModel;
        } catch {
            s.stop(red('Failed to fetch models. Please make sure Ollama is running and accessible.'));
            return { baseUrl, apiKey, model: null };
        }
    } else if (provider === 'anthropic') {
        // For Anthropic, use static model list
        const anthropic = new Anthropic({ baseURL: baseUrl.trim(), apiKey });
        const s = spinner();
        s.start('Fetching available models from Anthropic...');

        try {
            const modelsResponse = await anthropic.models.list();
            const modelChoices = modelsResponse.data.map((m) => ({
                value: m.id,
                label: m.id,
            }));

            s.stop('Models fetched.');

            const selectedModel = await select({
                message: 'Select the Anthropic model to use',
                options: modelChoices,
                initialValue:
                    currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
                        ? currentConfig.model
                        : modelChoices[0].value,
            });

            if (typeof selectedModel !== 'string') {
                return { baseUrl, apiKey, model: null };
            }

            model = selectedModel;
        } catch {
            s.stop(red('Failed to fetch models. Please check your base URL and API key.'));
            return { baseUrl, apiKey, model: null };
        }
    } else {
        // OpenAI: fetch available models
        const s = spinner();
        s.start('Fetching available models from OpenAI...');

        try {
            const openai = new OpenAI({ baseURL: baseUrl.trim(), apiKey });
            const modelsResponse = await openai.models.list();
            const modelChoices = modelsResponse.data
                .filter((m) => {
                    const id = m.id.toLowerCase();
                    return baseUrl.trim() === 'https://api.openai.com/v1'
                        ? id.includes('gpt') &&
                              !id.includes('dall-e') &&
                              !id.includes('audio') &&
                              !id.includes('tts') &&
                              !id.includes('transcribe') &&
                              !id.includes('search') &&
                              !id.includes('realtime') &&
                              !id.includes('image') &&
                              !id.includes('preview')
                        : true;
                })
                .map((m) => ({
                    value: m.id,
                    label: m.id,
                }));

            if (modelChoices.length === 0) {
                s.stop(red('No GPT models found for your credentials.'));
                return { baseUrl, apiKey, model: null };
            }

            s.stop('Models fetched.');

            const selectedModel = await select({
                message: 'Select the OpenAI model to use',
                options: modelChoices,
                initialValue:
                    currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
                        ? currentConfig.model
                        : modelChoices[0].value,
            });

            if (typeof selectedModel !== 'string') {
                return { baseUrl, apiKey, model: null };
            }

            model = selectedModel;
        } catch {
            s.stop(red('Failed to fetch models. Please check your base URL and API key.'));
            return { baseUrl, apiKey, model: null };
        }
    }

    return { baseUrl: baseUrl.trim(), apiKey, model };
}
