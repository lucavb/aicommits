import iso6391, { LanguageCode } from 'iso-639-1';
import { z } from 'zod';

export const configKeys = [
    'apiKey',
    'baseUrl',
    'contextLines',
    'exclude',
    'globalIgnore',
    'locale',
    'maxLength',
    'model',
    'provider',
    'type',
] as const;

export const providerNameSchema = z.enum(['openai', 'anthropic', 'bedrock', 'ollama', 'openrouter']);

const baseProfileConfigSchema = z.object({
    contextLines: z.coerce.number().positive().default(10),
    exclude: z.array(z.string().min(1)).optional(),
    locale: z
        .string()
        .length(2)
        .default('en')
        .refine((str: string): str is LanguageCode => iso6391.validate(str)),
    maxLength: z.coerce.number().int().positive().default(50),
    stageAll: z.boolean().or(
        z
            .string()
            .optional()
            .transform((str) => str === 'true'),
    ),
    type: z.enum(['conventional', ''] as const).optional(),
});

const openAIProfileConfigSchema = baseProfileConfigSchema.extend({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.url(),
    model: z.string().min(1),
    provider: z.literal('openai'),
    useResponsesApi: z.boolean().optional(),
});

const anthropicProfileConfigSchema = baseProfileConfigSchema.extend({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.url(),
    model: z.string().min(1),
    provider: z.literal('anthropic'),
});

const bedrockProfileConfigSchema = baseProfileConfigSchema.extend({
    model: z.string().min(1),
    provider: z.literal('bedrock'),
});

const ollamaProfileConfigSchema = baseProfileConfigSchema.extend({
    baseUrl: z.url().optional(),
    model: z.string().min(1),
    provider: z.literal('ollama'),
});

const openRouterProfileConfigSchema = baseProfileConfigSchema.extend({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.url(),
    model: z.string().min(1),
    provider: z.literal('openrouter'),
});

export const profileConfigSchema = z.discriminatedUnion('provider', [
    anthropicProfileConfigSchema,
    bedrockProfileConfigSchema,
    ollamaProfileConfigSchema,
    openAIProfileConfigSchema,
    openRouterProfileConfigSchema,
]);

export const configSchema = z.object({
    currentProfile: z.string().default('default'),
    globalIgnore: z.array(z.string().min(1)).optional(),
    profiles: z.record(z.string().min(1), profileConfigSchema),
});

export type Config = z.TypeOf<typeof configSchema>;
export type ProfileConfig = z.TypeOf<typeof profileConfigSchema>;
export type ProviderName = z.infer<typeof providerNameSchema>;
