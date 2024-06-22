import OpenAI from 'openai';
import { Config } from './config';
import { generateCommitMessagePrompt, generateSummaryPrompt } from './prompt';

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

    const [commitMessageCompletion, commitBodyCompletion] = await Promise.all([
        openai.chat.completions.create({
            frequency_penalty: 0,
            max_tokens: 4000,
            messages: [
                {
                    role: 'system',
                    content: generateCommitMessagePrompt(locale, maxLength, type ?? ''),
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
        }),
        openai.chat.completions.create({
            frequency_penalty: 0,
            max_tokens: 4000,
            messages: [
                {
                    role: 'system',
                    content: generateSummaryPrompt(locale),
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
        }),
    ]);

    return {
        commitMessage: deduplicateMessages(
            commitMessageCompletion.choices
                .map((choice) => choice.message?.content)
                .filter((content: string | null): content is string => typeof content === 'string')
                .map((content) => sanitizeMessage(content)),
        ),
        bodies: commitBodyCompletion.choices
            .map((choice) => choice.message.content?.trim())
            .filter((content): content is string => typeof content === 'string'),
    };
};
