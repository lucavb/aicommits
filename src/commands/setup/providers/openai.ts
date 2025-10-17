import { red } from 'kolorist';
import { z } from 'zod';
import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type ProfileConfig } from '../../../utils/config';
import { type ModelChoice, type ModelSetupResult, type ProviderModelHandler } from './types';

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

    // 2. Get API key
    const apiKeyInput = await promptUI.text({
        message: 'Enter your OpenAI API key',
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
    s.start('Fetching available models from OpenAI...');

    let modelChoices: ModelChoice[];
    try {
        modelChoices = await fetchOpenAIModels(baseUrl.trim(), apiKey);

        if (modelChoices.length === 0) {
            s.stop(red('No GPT models found for your credentials.'));
            return { baseUrl: baseUrl.trim(), apiKey, model: null };
        }

        s.stop('Models fetched.');
    } catch {
        s.stop(red('Failed to fetch models. Please check your base URL and API key.'));
        return { baseUrl: baseUrl.trim(), apiKey, model: null };
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
        return { baseUrl: baseUrl.trim(), apiKey, model: null };
    }

    return { baseUrl: baseUrl.trim(), apiKey, model: selectedModel };
}

export const openaiHandler: ProviderModelHandler = {
    setup: setupOpenAIModel,
};
