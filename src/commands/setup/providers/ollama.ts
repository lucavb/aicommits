import { red } from 'kolorist';
import { z } from 'zod';
import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type ProfileConfig } from '../../../utils/config';
import { type ModelChoice, type ModelSetupResult, type ProviderModelHandler } from './types';

const ollamaModelSchema = z.object({
    name: z.string(),
    model: z.string().optional(),
    modified_at: z.string().optional(),
    size: z.number().optional(),
    digest: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
});

const ollamaModelsResponseSchema = z.object({
    models: z.array(ollamaModelSchema),
});

const BASE_URL = 'http://localhost:11434/api';

async function fetchOllamaModels(baseUrl: string): Promise<ModelChoice[]> {
    const response = await fetch(`${baseUrl}/tags`, {
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const rawData = await response.json();
    const parseResult = ollamaModelsResponseSchema.safeParse(rawData);

    if (!parseResult.success) {
        throw new Error(`Invalid response format from Ollama API: ${parseResult.error.message}`);
    }

    const data = parseResult.data;
    return data.models.map((model) => ({
        value: model.name,
        label: model.name,
    }));
}

async function setupOllamaModel(
    promptUI: ClackPromptService,
    currentConfig?: Partial<ProfileConfig>,
): Promise<ModelSetupResult> {
    // 1. Get base URL
    const baseUrl = await promptUI.text({
        message: 'Enter the Ollama API base URL',
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
        return { baseUrl: undefined, model: null };
    }

    // 2. Get model by fetching from API
    const s = promptUI.spinner();
    s.start('Fetching available models from Ollama...');

    let modelChoices: ModelChoice[];
    try {
        modelChoices = await fetchOllamaModels(baseUrl.trim());

        if (modelChoices.length === 0) {
            s.stop(red('No Ollama models found. Make sure Ollama is running.'));
            return { baseUrl: baseUrl.trim(), model: null };
        }

        s.stop('Models fetched.');
    } catch {
        s.stop(red('Failed to fetch models. Please check that Ollama is running at the specified URL.'));
        return { baseUrl: baseUrl.trim(), model: null };
    }

    const selectedModel = await promptUI.select({
        message: 'Select the Ollama model to use',
        options: modelChoices,
        initialValue:
            currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
                ? currentConfig.model
                : modelChoices[0].value,
    });

    if (typeof selectedModel !== 'string') {
        return { baseUrl: baseUrl.trim(), model: null };
    }

    return { baseUrl: baseUrl.trim(), model: selectedModel };
}

export const ollamaHandler: ProviderModelHandler = {
    setup: setupOllamaModel,
};
