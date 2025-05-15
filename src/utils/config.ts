import iso6391, { LanguageCode } from 'iso-639-1';
import { z, ZodType } from 'zod';

export const configKeys = [
    'apiKey',
    'baseUrl',
    'contextLines',
    'exclude',
    'generate',
    'locale',
    'maxLength',
    'model',
    'provider',
    'type',
] as const;

export const configSchema = z.object({
    apiKey: z.string().min(1).optional(),
    baseUrl: z.string().url(),
    contextLines: z.coerce.number().positive().default(10),
    exclude: z.array(z.string().min(1)).optional(),
    generate: z.coerce.number().int().min(1).default(1),
    locale: z
        .string()
        .length(2)
        .default('en')
        .refine((str: string): str is LanguageCode => iso6391.validate(str)),
    maxLength: z.coerce.number().int().positive().default(50),
    model: z.string().min(1),
    provider: z.enum(['openai', 'ollama']).default('openai'),
    stageAll: z.boolean().or(
        z
            .string()
            .optional()
            .transform((str) => str === 'true'),
    ),
    type: z.enum(['conventional', ''] as const).optional(),
} satisfies Record<(typeof configKeys)[number], ZodType> & Record<string, ZodType>);

export type Config = z.TypeOf<typeof configSchema>;
