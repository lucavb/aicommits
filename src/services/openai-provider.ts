import OpenAI from 'openai';
import { Injectable } from '../utils/inversify';
import { AIProvider, AIProviderFactory } from './ai-provider.interface';

@Injectable()
export class OpenAIProvider implements AIProvider {
    private client: OpenAI;

    constructor(config: { baseUrl: string; apiKey?: string }) {
        this.client = new OpenAI({
            baseURL: config.baseUrl,
            apiKey: config.apiKey,
        });
    }

    async listModels(): Promise<string[]> {
        const models = await this.client.models.list();
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
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        model: string;
        temperature?: number;
        n?: number;
    }) {
        const completion = await this.client.chat.completions.create({
            messages: params.messages,
            model: params.model,
            temperature: params.temperature ?? 0.7,
            n: params.n ?? 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            top_p: 1,
        });

        return {
            choices: completion.choices.map((choice) => ({
                message: { content: choice.message.content ?? '' },
            })),
        };
    }
}

@Injectable()
export class OpenAIProviderFactory implements AIProviderFactory {
    createProvider(config: { baseUrl: string; apiKey?: string }): AIProvider {
        return new OpenAIProvider(config);
    }
}
