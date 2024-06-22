import iso6391, { LanguageCode } from 'iso-639-1';
import { join } from 'path';
import { z, ZodType } from 'zod';
import { promises as fs } from 'fs';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

export const configKeys = [
    'apiKey',
    'baseUrl',
    'contextLines',
    'exclude',
    'generate',
    'locale',
    'maxLength',
    'model',
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
    maxLength: z.number().int().positive().default(140),
    model: z.string().min(1),
    stageAll: z.boolean().or(
        z
            .string()
            .optional()
            .transform((str) => str === 'true'),
    ),
    type: z.enum(['conventional', ''] as const).optional(),
} satisfies Record<(typeof configKeys)[number], ZodType> & Record<string, ZodType>);

export type Config = z.TypeOf<typeof configSchema>;

const configFilePath = join(process.env.HOME || process.env.USERPROFILE || '.', '.aicommits.yaml');

export const readConfig = async (): Promise<Partial<Config>> => {
    try {
        const fileContents = await fs.readFile(configFilePath, 'utf8');
        return yamlParse(fileContents);
    } catch (error) {
        return {};
    }
};

export const writeConfig = async (config: Partial<Config>): Promise<void> => {
    const yamlStr = yamlStringify(config);
    await fs.writeFile(configFilePath, yamlStr, 'utf8');
};
