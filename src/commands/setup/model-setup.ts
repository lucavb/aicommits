import { red } from 'kolorist';
import { z } from 'zod';
import { type ProfileConfig, ProviderName } from '../../utils/config';
import { ClackPromptService } from '../../services/clack-prompt.service';

// Zod schemas for API responses
const openAIModelSchema = z.object({
    id: z.string(),
    object: z.string(),
    created: z.number().optional(),
    owned_by: z.string().optional(),
});

const openAIModelsResponseSchema = z.object({
    object: z.string(),
    data: z.array(openAIModelSchema),
});

const anthropicModelSchema = z.object({
    id: z.string(),
    type: z.string().optional(),
    display_name: z.string().optional(),
    created_at: z.string().optional(),
});

const anthropicModelsResponseSchema = z.object({
    data: z.array(anthropicModelSchema),
    has_more: z.boolean().optional(),
    first_id: z.string().optional(),
    last_id: z.string().optional(),
});

/**
 * Fetch available models from OpenAI API
 */
async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<{ value: string; label: string }[]> {
    const response = await fetch(`${baseUrl}/models`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const rawData = await response.json();
    const parseResult = openAIModelsResponseSchema.safeParse(rawData);

    if (!parseResult.success) {
        throw new Error(`Invalid response format from OpenAI API: ${parseResult.error.message}`);
    }

    const data = parseResult.data;
    return data.data
        .filter((model) => {
            const id = model.id.toLowerCase();
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
        .map((model) => ({
            value: model.id,
            label: model.id,
        }));
}

/**
 * Fetch available models from Anthropic API
 */
async function fetchAnthropicModels(baseUrl: string, apiKey: string): Promise<{ value: string; label: string }[]> {
    const response = await fetch(`${baseUrl}/v1/models`, {
        headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const rawData = await response.json();
    const parseResult = anthropicModelsResponseSchema.safeParse(rawData);

    if (!parseResult.success) {
        throw new Error(`Invalid response format from Anthropic API: ${parseResult.error.message}`);
    }

    const data = parseResult.data;
    return data.data.map((model) => ({
        value: model.id,
        label: model.display_name || model.id,
    }));
}

/**
 * Get the base URL placeholder based on the provider
 */
export function getBaseUrlPlaceholder(provider: ProviderName): string {
    if (provider === 'openai') {
        return 'https://api.openai.com/v1';
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
    return 'Enter the Anthropic API base URL';
}

/**
 * Get the initial value for the base URL field
 */
export function getBaseUrlInitialValue(provider: ProviderName, currentConfig?: Partial<ProfileConfig>): string {
    if (currentConfig?.baseUrl) {
        return currentConfig.baseUrl;
    }
    return getBaseUrlPlaceholder(provider);
}

/**
 * Setup the base URL, API key, and model
 */
export async function setupModel(
    promptUI: ClackPromptService,
    provider: ProviderName,
    currentConfig?: Partial<ProfileConfig>,
) {
    // 1. Get base URL
    const baseUrl = await promptUI.text({
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

    if (baseUrl === null || typeof baseUrl !== 'string' || !baseUrl.trim()) {
        return { baseUrl: null, apiKey: undefined, model: null };
    }

    // 2. Get API key (required for both OpenAI and Anthropic)
    const apiKeyInput = await promptUI.text({
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

    const apiKey = apiKeyInput.trim();

    // 3. Get model by fetching from API
    const s = promptUI.spinner();
    s.start(`Fetching available models from ${provider === 'openai' ? 'OpenAI' : 'Anthropic'}...`);

    let modelChoices: { value: string; label: string }[];
    try {
        if (provider === 'openai') {
            modelChoices = await fetchOpenAIModels(baseUrl.trim(), apiKey);
        } else {
            modelChoices = await fetchAnthropicModels(baseUrl.trim(), apiKey);
        }

        if (modelChoices.length === 0) {
            s.stop(red(`No ${provider === 'openai' ? 'GPT' : 'Claude'} models found for your credentials.`));
            return { baseUrl: baseUrl.trim(), apiKey, model: null };
        }

        s.stop('Models fetched.');
    } catch {
        s.stop(red('Failed to fetch models. Please check your base URL and API key.'));
        return { baseUrl: baseUrl.trim(), apiKey, model: null };
    }

    const selectedModel = await promptUI.select({
        message: `Select the ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} model to use`,
        options: modelChoices,
        initialValue:
            currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
                ? currentConfig.model
                : modelChoices[0].value,
    });

    if (typeof selectedModel !== 'string') {
        return { baseUrl: baseUrl.trim(), apiKey, model: null };
    }

    return { baseUrl: baseUrl.trim(), apiKey, model: selectedModel };
}
