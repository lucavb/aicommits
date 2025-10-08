import OpenAI from 'openai';
import { Inject, Injectable } from '../utils/inversify';
import { AIProvider, ReasoningEffort } from './ai-provider.interface';

type OpenAIWithSpecificFunctions = {
    chat: { completions: { create: InstanceType<typeof OpenAI>['chat']['completions']['create'] } };
    models: { list: InstanceType<typeof OpenAI>['models']['list'] };
};

const isReasoningModel = (model: string): boolean => {
    const modelLower = model.toLowerCase();
    return modelLower.startsWith('o1') || modelLower.startsWith('o3');
};

const prepareMessagesForReasoningModel = (
    messages: { role: string; content: string }[],
): { role: 'user' | 'assistant'; content: string }[] => {
    return messages.map((msg) => {
        if (msg.role === 'system') {
            return {
                role: 'user' as const,
                content: `System instructions: ${msg.content}`,
            };
        }
        return {
            role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
            content: msg.content,
        };
    });
};

@Injectable()
export class OpenAIProvider implements AIProvider {
    constructor(@Inject(OpenAI) private readonly openai: OpenAIWithSpecificFunctions) {}

    static create(config: { baseUrl?: string; apiKey?: string }): OpenAIProvider {
        if (!config.apiKey) {
            throw new Error('OpenAI API key is required');
        }
        const openai = new OpenAI({ baseURL: config.baseUrl, apiKey: config.apiKey });
        return new OpenAIProvider(openai);
    }

    async listModels(): Promise<string[]> {
        const models = await this.openai.models.list();
        return models.data
            .filter((m) => {
                const id = m.id.toLowerCase();
                const isReasoningModel = id.startsWith('o1') || id.startsWith('o3');
                const isGPTModel =
                    id.includes('gpt') &&
                    !id.includes('dall-e') &&
                    !id.includes('audio') &&
                    !id.includes('tts') &&
                    !id.includes('transcribe') &&
                    !id.includes('search') &&
                    !id.includes('realtime') &&
                    !id.includes('image');
                return isReasoningModel || isGPTModel;
            })
            .map((m) => m.id);
    }

    async generateCompletion(params: {
        messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
        model: string;
        temperature?: number;
        n?: number;
        reasoningEffort?: ReasoningEffort;
    }) {
        const isReasoning = isReasoningModel(params.model);
        const messages = isReasoning ? prepareMessagesForReasoningModel(params.messages) : params.messages;

        const baseParams = {
            messages,
            model: params.model,
            n: params.n ?? 1,
        };

        const completionParams = isReasoning
            ? {
                  ...baseParams,
                  ...(params.reasoningEffort ? { reasoning_effort: params.reasoningEffort } : {}),
              }
            : {
                  ...baseParams,
                  frequency_penalty: 0,
                  presence_penalty: 0,
                  temperature: params.temperature ?? 0.7,
                  top_p: 1,
              };

        const completion = (await this.openai.chat.completions.create(
            completionParams as Parameters<typeof this.openai.chat.completions.create>[0],
        )) as Awaited<ReturnType<typeof this.openai.chat.completions.create>> & { choices: { message: { content: string | null } }[] };

        return {
            choices: completion.choices.map((choice) => ({ message: { content: choice.message.content ?? '' } })),
        };
    }

    async streamCompletion(params: {
        messages: { role: string; content: string }[];
        model: string;
        temperature?: number;
        onMessageDelta: (content: string) => void;
        onComplete: (finalContent: string) => void;
        reasoningEffort?: ReasoningEffort;
    }): Promise<void> {
        const isReasoning = isReasoningModel(params.model);
        const messages = isReasoning
            ? prepareMessagesForReasoningModel(params.messages)
            : (params.messages as { role: 'system' | 'user' | 'assistant'; content: string }[]);

        const baseParams = {
            messages,
            model: params.model,
            stream: true as const,
        };

        const streamParams = isReasoning
            ? {
                  ...baseParams,
                  ...(params.reasoningEffort ? { reasoning_effort: params.reasoningEffort } : {}),
              }
            : {
                  ...baseParams,
                  frequency_penalty: 0,
                  presence_penalty: 0,
                  temperature: params.temperature ?? 0.7,
                  top_p: 1,
              };

        const stream = (await this.openai.chat.completions.create(
            streamParams as Parameters<typeof this.openai.chat.completions.create>[0],
        )) as AsyncIterable<{ choices: { delta?: { content?: string } }[] }>;

        let fullContent = '';

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                fullContent += content;
                params.onMessageDelta(content);
            }
        }

        params.onComplete(fullContent);
    }
}
