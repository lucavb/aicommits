import { red } from 'kolorist';
import { z } from 'zod';
import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type ProfileConfig } from '../../../utils/config';
import { type ModelChoice, type ModelSetupContext, type ModelSetupResult, type ProviderModelHandler } from './types';
import { collectApiKeyForSetup } from './api-key-setup';

const openRouterModelSchema = z.object({
    context_length: z.number().optional(),
    created: z.number().optional(),
    id: z.string(),
    name: z.string().optional(),
    pricing: z.object({ completion: z.string().optional(), prompt: z.string().optional() }).optional(),
});

const openRouterModelsResponseSchema = z.object({ data: z.array(openRouterModelSchema) });

const BASE_URL = 'https://openrouter.ai/api/v1';

async function fetchOpenRouterModels(baseUrl: string, apiKey: string) {
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
    const parseResult = openRouterModelsResponseSchema.safeParse(rawData);

    if (!parseResult.success) {
        throw new Error(`Invalid response format from OpenRouter API: ${parseResult.error.message}`);
    }

    const data = parseResult.data;
    return data.data.map(
        (model) =>
            ({
                value: model.id,
                label: model.name || model.id,
            }) as const satisfies ModelChoice,
    );
}

async function setupOpenRouterModel(
    promptUI: ClackPromptService,
    context: ModelSetupContext,
    currentConfig?: Partial<ProfileConfig>,
) {
    // 1. Get base URL
    const baseUrl = await promptUI.text({
        message: 'Enter the OpenRouter API base URL',
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
        return { baseUrl: undefined, apiKey: undefined, model: null } as const satisfies ModelSetupResult;
    }

    const currentApiKey = currentConfig && 'apiKey' in currentConfig ? currentConfig.apiKey : undefined;
    const resolvedApiKey = context.resolveApiKey(currentApiKey);
    const sourceEnvVar = context.getApiKeySourceEnvVar(currentApiKey);

    const apiKeyResult = await collectApiKeyForSetup({
        promptUI,
        providerLabel: 'OpenRouter',
        currentApiKey,
        resolvedApiKey,
        sourceEnvVar,
    });

    if (!apiKeyResult) {
        return { baseUrl, apiKey: undefined, model: null } as const satisfies ModelSetupResult;
    }

    const { apiKey, persistApiKey } = apiKeyResult;
    const persistedApiKey = persistApiKey ? apiKey : undefined;

    // 3. Get model by fetching from API
    const s = promptUI.spinner();
    s.start('Fetching available models from OpenRouter...');

    let modelChoices: ModelChoice[];
    try {
        modelChoices = await fetchOpenRouterModels(baseUrl.trim(), apiKey);

        if (modelChoices.length === 0) {
            s.stop(red('No models found for your credentials.'));
            return {
                baseUrl: baseUrl.trim(),
                apiKey: persistedApiKey,
                model: null,
            } as const satisfies ModelSetupResult;
        }

        s.stop('Models fetched.');
    } catch {
        s.stop(red('Failed to fetch models. Please check your base URL and API key.'));
        return { baseUrl: baseUrl.trim(), apiKey: persistedApiKey, model: null } as const satisfies ModelSetupResult;
    }

    const selectedModel = await promptUI.select({
        message: 'Select the OpenRouter model to use',
        options: modelChoices,
        initialValue:
            currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
                ? currentConfig.model
                : modelChoices[0].value,
    });

    if (typeof selectedModel !== 'string') {
        return { baseUrl: baseUrl.trim(), apiKey: persistedApiKey, model: null } as const satisfies ModelSetupResult;
    }

    return {
        baseUrl: baseUrl.trim(),
        apiKey: persistedApiKey,
        model: selectedModel,
    } as const satisfies ModelSetupResult;
}

export const openrouterHandler = {
    setup: setupOpenRouterModel,
} as const satisfies ProviderModelHandler;
