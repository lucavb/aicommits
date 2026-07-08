import { red } from 'kolorist';
import { z } from 'zod';
import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type ProfileConfig } from '../../../utils/config';
import { type ModelChoice, type ModelSetupContext, type ModelSetupResult, type ProviderModelHandler } from './types';
import { collectApiKeyForSetup } from './api-key-setup';

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
    context: ModelSetupContext,
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

    const currentApiKey = currentConfig && 'apiKey' in currentConfig ? currentConfig.apiKey : undefined;
    const resolvedApiKey = context.resolveApiKey(currentApiKey);
    const sourceEnvVar = context.getApiKeySourceEnvVar(currentApiKey);

    const apiKeyResult = await collectApiKeyForSetup({
        promptUI,
        providerLabel: 'Anthropic',
        currentApiKey,
        resolvedApiKey,
        sourceEnvVar,
    });

    if (!apiKeyResult) {
        return { baseUrl, apiKey: undefined, model: null };
    }

    const { apiKey, persistApiKey } = apiKeyResult;
    const persistedApiKey = persistApiKey ? apiKey : undefined;

    // 3. Get model by fetching from API
    const s = promptUI.spinner();
    s.start('Fetching available models from Anthropic...');

    let modelChoices: ModelChoice[];
    try {
        modelChoices = await fetchAnthropicModels(baseUrl.trim(), apiKey);

        if (modelChoices.length === 0) {
            s.stop(red('No Claude models found for your credentials.'));
            return { baseUrl: baseUrl.trim(), apiKey: persistedApiKey, model: null };
        }

        s.stop('Models fetched.');
    } catch {
        s.stop(red('Failed to fetch models. Please check your base URL and API key.'));
        return { baseUrl: baseUrl.trim(), apiKey: persistedApiKey, model: null };
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
        return { baseUrl: baseUrl.trim(), apiKey: persistedApiKey, model: null };
    }

    return { baseUrl: baseUrl.trim(), apiKey: persistedApiKey, model: selectedModel };
}

export const anthropicHandler: ProviderModelHandler = {
    setup: setupAnthropicModel,
};
