import { z } from 'zod';

export const openAIModelSchema = z.object({
    id: z.string(),
    object: z.string(),
    created: z.number().optional(),
    owned_by: z.string(),
    permission: z.array(z.unknown()).optional(),
});

export const openAIModelsResponseSchema = z.object({
    object: z.string(),
    data: z.array(openAIModelSchema),
});

export const anthropicModelSchema = z.object({
    id: z.string(),
    display_name: z.string(),
    created_at: z.string(),
    type: z.string(),
});

export const anthropicModelsResponseSchema = z.object({
    data: z.array(anthropicModelSchema),
});

export const ollamaModelDetailsSchema = z.object({
    format: z.string(),
    family: z.string(),
    families: z.array(z.string()).nullable(),
    parameter_size: z.string(),
    quantization_level: z.string(),
    parent_model: z.string().optional(),
});

export const ollamaModelSchema = z.object({
    name: z.string(),
    model: z.string(),
    modified_at: z.string(),
    size: z.number(),
    digest: z.string(),
    details: ollamaModelDetailsSchema,
});

export const ollamaModelsResponseSchema = z.object({
    models: z.array(ollamaModelSchema),
});

export const unifiedModelSchema = z.object({
    id: z.string(),
    name: z.string(),
    provider: z.enum(['openai', 'anthropic', 'ollama']),
    created_at: z.string().optional(),
});

export const modelDiscoveryResultSchema = z.object({
    success: z.boolean(),
    models: z.array(unifiedModelSchema),
    error: z.string().optional(),
});

export const modelDiscoveryConfigSchema = z.object({
    provider: z.enum(['openai', 'anthropic', 'ollama']),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    timeout: z.number().optional(),
});

export type OpenAIModel = z.infer<typeof openAIModelSchema>;
export type OpenAIModelsResponse = z.infer<typeof openAIModelsResponseSchema>;
export type AnthropicModel = z.infer<typeof anthropicModelSchema>;
export type AnthropicModelsResponse = z.infer<typeof anthropicModelsResponseSchema>;
export type OllamaModel = z.infer<typeof ollamaModelSchema>;
export type OllamaModelsResponse = z.infer<typeof ollamaModelsResponseSchema>;
export type UnifiedModel = z.infer<typeof unifiedModelSchema>;
export type ModelDiscoveryResult = z.infer<typeof modelDiscoveryResultSchema>;
export type ModelDiscoveryConfig = z.infer<typeof modelDiscoveryConfigSchema>;
