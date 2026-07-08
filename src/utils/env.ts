import { z } from 'zod';

const optionalNonEmptyString = z
    .string()
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : undefined));

const environmentSchema = z
    .object({
        HOME: z.string().optional(),
        USERPROFILE: z.string().optional(),
        AIC_PROFILE: optionalNonEmptyString,
        AIC_API_KEY: optionalNonEmptyString,
        OPENAI_API_KEY: optionalNonEmptyString,
        ANTHROPIC_API_KEY: optionalNonEmptyString,
        OPENROUTER_API_KEY: optionalNonEmptyString,
    })
    .catchall(optionalNonEmptyString);

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(raw: NodeJS.ProcessEnv): Environment {
    return environmentSchema.parse(raw);
}

export const emptyEnvironment = parseEnvironment({});
