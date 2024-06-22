import OpenAI from 'openai';
import { Config } from './config';
import { generatePrompt } from './prompt';

const sanitizeMessage = (message: string) =>
    message
        .trim()
        .replace(/[\n\r]/g, '')
        .replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

export const generateCommitMessage = async ({
    apiKey,
    baseUrl,
    diff,
    generate,
    locale,
    maxLength,
    model,
    type,
}: Config & { diff: string }) => {
    const openai = new OpenAI({ baseURL: baseUrl, apiKey });

    const completion = await openai.chat.completions.create({
        frequency_penalty: 0,
        max_tokens: 200,
        messages: [
            {
                role: 'system',
                content: generatePrompt(locale, maxLength, type ?? ''),
            },
            {
                role: 'user',
                content: diff,
            },
        ],
        model,
        n: generate,
        presence_penalty: 0,
        stream: false,
        temperature: 0.7,
        top_p: 1,
    });

    return deduplicateMessages(
        completion.choices
            .map((choice) => choice.message?.content)
            .filter((content: string | null): content is string => typeof content === 'string')
            .map((content) => sanitizeMessage(content)),
    );
};
