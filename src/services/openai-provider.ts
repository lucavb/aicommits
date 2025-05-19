import OpenAI from 'openai';
import { Inject, Injectable } from '../utils/inversify';
import { AIProvider } from './ai-provider.interface';

type OpenAIWithSpecificFunctions = {
    chat: { completions: { create: InstanceType<typeof OpenAI>['chat']['completions']['create'] } };
    models: { list: InstanceType<typeof OpenAI>['models']['list'] };
};

@Injectable()
export class OpenAIProvider implements AIProvider {
    constructor(@Inject(OpenAI) private readonly openai: OpenAIWithSpecificFunctions) {}

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
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
        model: string;
        temperature?: number;
        n?: number;
    }) {
        const completion = await this.openai.chat.completions.create({
            messages: params.messages,
            model: params.model,
            temperature: params.temperature ?? 0.7,
            n: params.n ?? 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            top_p: 1,
        });

        return {
            choices: completion.choices.map((choice) => ({ message: { content: choice.message.content ?? '' } })),
        };
    }
}
