import { z } from 'zod';

export const configKeys = ['apiKey', 'baseUrl', 'contextLines', 'exclude', 'maxLength', 'model', 'provider'] as const;

export const providerNameSchema = z.enum(['openai', 'ollama', 'anthropic']);

export const profileConfigSchema = z.object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url(),
    contextLines: z.coerce.number().positive().default(10),
    exclude: z.array(z.string().min(1)).optional(),
    maxLength: z.coerce.number().int().positive().default(50),
    model: z.string().min(1),
    provider: providerNameSchema.default('openai'),
    stageAll: z.boolean().or(
        z
            .string()
            .optional()
            .transform((str) => str === 'true'),
    ),
    type: z.string().optional(),
});

export const configSchema = z.object({
    currentProfile: z.string().default('default'),
    profiles: z.record(z.string().min(1), profileConfigSchema),
});

export type Config = z.TypeOf<typeof configSchema>;
export type ProfileConfig = z.TypeOf<typeof profileConfigSchema>;
export type ProviderName = z.infer<typeof providerNameSchema>;
