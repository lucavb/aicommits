import { red } from 'kolorist';
import { z } from 'zod';
import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type ProfileConfig } from '../../../utils/config';
import { type ModelChoice, type ModelSetupResult, type ProviderModelHandler } from './types';

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

const BASE_URL = 'https://api.anthropic.com';

async function fetchAnthropicModels(baseUrl: string, apiKey: string): Promise<ModelChoice[]> {
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

async function setupAnthropicModel(
    promptUI: ClackPromptService,
    currentConfig?: Partial<ProfileConfig>,
): Promise<ModelSetupResult> {
    // 1. Get base URL
    const baseUrl = await promptUI.text({
        message: 'Enter the Anthropic API base URL',
        placeholder: BASE_URL,
        initialValue:
            currentConfig && 'baseUrl' in currentConfig && currentConfig.baseUrl ? currentConfig.baseUrl : BASE_URL,
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
        return { baseUrl: undefined, apiKey: undefined, model: null };
    }

    // 2. Get API key
    const apiKeyInput = await promptUI.text({
        message: 'Enter your Anthropic API key',
        placeholder: 'Your API key',
        initialValue: currentConfig && 'apiKey' in currentConfig ? currentConfig.apiKey : undefined,
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
    s.start('Fetching available models from Anthropic...');

    let modelChoices: ModelChoice[];
    try {
        modelChoices = await fetchAnthropicModels(baseUrl.trim(), apiKey);

        if (modelChoices.length === 0) {
            s.stop(red('No Claude models found for your credentials.'));
            return { baseUrl: baseUrl.trim(), apiKey, model: null };
        }

        s.stop('Models fetched.');
    } catch {
        s.stop(red('Failed to fetch models. Please check your base URL and API key.'));
        return { baseUrl: baseUrl.trim(), apiKey, model: null };
    }

    const selectedModel = await promptUI.select({
        message: 'Select the Anthropic model to use',
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

export const anthropicHandler: ProviderModelHandler = {
    setup: setupAnthropicModel,
};
