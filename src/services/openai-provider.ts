import OpenAI from 'openai';
import { Inject, Injectable } from '../utils/inversify';
import { AIProvider } from './ai-provider.interface';

type OpenAIWithSpecificFunctions = {
    chat: { completions: { create: InstanceType<typeof OpenAI>['chat']['completions']['create'] } };
    models: { list: InstanceType<typeof OpenAI>['models']['list'] };
};

// Some models (reasoning / next-gen) do not support custom temperature or top_p values.
// This list can be expanded easily as new models appear.
function modelSupportsCustomTemperature(modelId: string): boolean {
    const unsupportedModels = [
        /^gpt-5/i,  // All GPT-5 series
        /^o1/i,     // o1 reasoning models
        /^o3/i,     // o3-mini and similar o-series reasoning models
    ];

    return !unsupportedModels.some((pattern) => pattern.test(modelId));
}

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
                return (
                    id.includes('gpt') &&
                    !id.includes('dall-e') &&
                    !id.includes('audio') &&
                    !id.includes('tts') &&
                    !id.includes('transcribe') &&
                    !id.includes('search') &&
                    !id.includes('realtime') &&
                    !id.includes('image') &&
                    !id.includes('preview')
                );
            })
            .map((m) => m.id);
    }

    async generateCompletion(params: {
        messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
        model: string;
        temperature?: number;
        n?: number;
    }) {
        const completion = await this.openai.chat.completions.create({
            frequency_penalty: 0,
            messages: params.messages,
            model: params.model,
            n: params.n ?? 1,
            presence_penalty: 0,
            // Only include temperature for models that support custom values (GPT-5* rejects non-default)
            ...( modelSupportsCustomTemperature(params.model)
                ? { temperature: params.temperature ?? 0.7 }
                : {} ),
            top_p: 1,
        });

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
    }): Promise<void> {
        const stream = await this.openai.chat.completions.create({
            frequency_penalty: 0,
            messages: params.messages as { role: 'system' | 'user' | 'assistant'; content: string }[],
            model: params.model,
            presence_penalty: 0,
            stream: true,
            // Only include temperature for models that support custom values (GPT-5* rejects non-default)
            ...( modelSupportsCustomTemperature(params.model)
                ? { temperature: params.temperature ?? 0.7 }
                : {} ),
            top_p: 1,
        });

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
