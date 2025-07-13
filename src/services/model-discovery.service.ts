import { injectable } from 'inversify';
import {
    ModelDiscoveryConfig,
    ModelDiscoveryResult,
    UnifiedModel,
    openAIModelsResponseSchema,
    anthropicModelsResponseSchema,
    ollamaModelsResponseSchema,
    modelDiscoveryConfigSchema,
} from './model-discovery.types';

@injectable()
export class ModelDiscoveryService {
    private readonly DEFAULT_TIMEOUTS = {
        openai: 30000,
        anthropic: 30000,
        ollama: 10000, // Local service should be faster
    };

    private readonly DEFAULT_URLS = {
        openai: 'https://api.openai.com/v1',
        anthropic: 'https://api.anthropic.com/v1',
        ollama: 'http://localhost:11434/api',
    };

    async discoverModels(config: ModelDiscoveryConfig): Promise<ModelDiscoveryResult> {
        try {
            // Validate config with Zod
            const validatedConfig = modelDiscoveryConfigSchema.parse(config);

            switch (validatedConfig.provider) {
                case 'openai':
                    return await this.discoverOpenAIModels(validatedConfig);
                case 'anthropic':
                    return await this.discoverAnthropicModels(validatedConfig);
                case 'ollama':
                    return await this.discoverOllamaModels(validatedConfig);
                default:
                    throw new Error(`Unsupported provider: ${validatedConfig.provider}`);
            }
        } catch (error) {
            return {
                success: false,
                models: [],
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }

    private async discoverOpenAIModels(config: ModelDiscoveryConfig): Promise<ModelDiscoveryResult> {
        const baseUrl = config.baseUrl || this.DEFAULT_URLS.openai;
        const timeout = config.timeout || this.DEFAULT_TIMEOUTS.openai;

        if (!config.apiKey) {
            throw new Error('OpenAI API key is required');
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(`${baseUrl}/models`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`OpenAI API error (${response.status}): ${await response.text()}`);
            }

            const data = await response.json();
            const validatedData = openAIModelsResponseSchema.parse(data);

            const models: UnifiedModel[] = validatedData.data.map((model) => ({
                id: model.id,
                name: model.id,
                provider: 'openai' as const,
                created_at: model.created ? new Date(model.created * 1000).toISOString() : undefined,
            }));

            return {
                success: true,
                models: models.filter((model) => model.id.includes('gpt')), // Filter to only GPT models
            };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async discoverAnthropicModels(config: ModelDiscoveryConfig): Promise<ModelDiscoveryResult> {
        const baseUrl = config.baseUrl || this.DEFAULT_URLS.anthropic;
        const timeout = config.timeout || this.DEFAULT_TIMEOUTS.anthropic;

        if (!config.apiKey) {
            throw new Error('Anthropic API key is required');
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(`${baseUrl}/models`, {
                method: 'GET',
                headers: {
                    'x-api-key': config.apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`Anthropic API error (${response.status}): ${await response.text()}`);
            }

            const data = await response.json();
            const validatedData = anthropicModelsResponseSchema.parse(data);

            const models: UnifiedModel[] = validatedData.data.map((model) => ({
                id: model.id,
                name: model.display_name,
                provider: 'anthropic' as const,
                created_at: model.created_at,
            }));

            return {
                success: true,
                models,
            };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async discoverOllamaModels(config: ModelDiscoveryConfig): Promise<ModelDiscoveryResult> {
        const baseUrl = config.baseUrl || this.DEFAULT_URLS.ollama;
        const timeout = config.timeout || this.DEFAULT_TIMEOUTS.ollama;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(`${baseUrl}/tags`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`Ollama API error (${response.status}): ${await response.text()}`);
            }

            const data = await response.json();
            const validatedData = ollamaModelsResponseSchema.parse(data);

            const models: UnifiedModel[] = validatedData.models.map((model) => ({
                id: model.name,
                name: model.name,
                provider: 'ollama' as const,
                created_at: model.modified_at,
            }));

            return {
                success: true,
                models,
            };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Test connection to a provider without discovering models
     */
    async testConnection(config: ModelDiscoveryConfig): Promise<{ success: boolean; error?: string }> {
        const result = await this.discoverModels(config);
        return {
            success: result.success,
            error: result.error,
        };
    }

    /**
     * Get available providers
     */
    getAvailableProviders(): ('openai' | 'anthropic' | 'ollama')[] {
        return ['openai', 'anthropic', 'ollama'];
    }
}
