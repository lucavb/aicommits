import iso6391, { LanguageCode } from 'iso-639-1';
import { z } from 'zod';

export const configKeys = [
    'apiKey',
    'baseUrl',
    'contextLines',
    'exclude',
    'locale',
    'maxLength',
    'model',
    'provider',
    'type',
] as const;

export const providerNameSchema = z.enum(['openai', 'anthropic']);

export const profileConfigSchema = z.object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url(),
    contextLines: z.coerce.number().positive().default(10),
    exclude: z.array(z.string().min(1)).optional(),
    locale: z
        .string()
        .length(2)
        .default('en')
        .refine((str: string): str is LanguageCode => iso6391.validate(str)),
    maxLength: z.coerce.number().int().positive().default(50),
    model: z.string().min(1),
    provider: providerNameSchema.default('openai'),
    stageAll: z.boolean().or(
        z
            .string()
            .optional()
            .transform((str) => str === 'true'),
    ),
    type: z.enum(['conventional', ''] as const).optional(),
});

export const configSchema = z.object({
    currentProfile: z.string().default('default'),
    profiles: z.record(z.string().min(1), profileConfigSchema),
});

export type Config = z.TypeOf<typeof configSchema>;
export type ProfileConfig = z.TypeOf<typeof profileConfigSchema>;
export type ProviderName = z.infer<typeof providerNameSchema>;
