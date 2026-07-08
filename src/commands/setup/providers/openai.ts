import { red } from 'kolorist';
import { z } from 'zod';
import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type ProfileConfig } from '../../../utils/config';
import { type ModelChoice, type ModelSetupContext, type ModelSetupResult, type ProviderModelHandler } from './types';
import { collectApiKeyForSetup } from './api-key-setup';

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

const BASE_URL = 'https://api.openai.com/v1';

async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<ModelChoice[]> {
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
            return baseUrl.trim() === BASE_URL
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

async function setupOpenAIModel(
    promptUI: ClackPromptService,
    context: ModelSetupContext,
    currentConfig?: Partial<ProfileConfig>,
): Promise<ModelSetupResult> {
    // 1. Get base URL
    const baseUrl = await promptUI.text({
        message: 'Enter the OpenAI API base URL',
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
        providerLabel: 'OpenAI',
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
    s.start('Fetching available models from OpenAI...');

    let modelChoices: ModelChoice[];
    try {
        modelChoices = await fetchOpenAIModels(baseUrl.trim(), apiKey);

        if (modelChoices.length === 0) {
            s.stop(red('No GPT models found for your credentials.'));
            return { baseUrl: baseUrl.trim(), apiKey: persistedApiKey, model: null };
        }

        s.stop('Models fetched.');
    } catch {
        s.stop(red('Failed to fetch models. Please check your base URL and API key.'));
        return { baseUrl: baseUrl.trim(), apiKey: persistedApiKey, model: null };
    }

    const selectedModel = await promptUI.select({
        message: 'Select the OpenAI model to use',
        options: modelChoices,
        initialValue:
            currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
                ? currentConfig.model
                : modelChoices[0].value,
    });

    if (typeof selectedModel !== 'string') {
        return { baseUrl: baseUrl.trim(), apiKey: persistedApiKey, model: null };
    }

    // 4. Ask about using the responses API
    promptUI.note(
        'The /responses API is a newer endpoint. If unsure, you can opt out now and configure this later using: aicommits config set useResponsesApi true',
    );

    const useResponsesApi = await promptUI.confirm({
        message: 'Do you want to use the newer /responses API endpoint?',
        initialValue:
            currentConfig && 'useResponsesApi' in currentConfig ? (currentConfig.useResponsesApi ?? false) : false,
    });

    if (useResponsesApi === null || promptUI.isCancel(useResponsesApi)) {
        return { baseUrl: baseUrl.trim(), apiKey: persistedApiKey, model: selectedModel };
    }

    return {
        apiKey: persistedApiKey,
        baseUrl: baseUrl.trim(),
        model: selectedModel,
        useResponsesApi,
    };
}

export const openaiHandler: ProviderModelHandler = {
    setup: setupOpenAIModel,
};
