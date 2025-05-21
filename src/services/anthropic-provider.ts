import { AIProvider } from './ai-provider.interface';
import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable } from '../utils/inversify';

type AnthropicWithSpecificFunctions = {
    messages: { create: InstanceType<typeof Anthropic>['messages']['create'] };
    models: { list: InstanceType<typeof Anthropic>['models']['list'] };
};

@Injectable()
export class AnthropicProvider implements AIProvider {
    constructor(@Inject(Anthropic) private readonly anthropic: AnthropicWithSpecificFunctions) {}

    static create(config: { baseUrl?: string; apiKey?: string }): AnthropicProvider {
        if (!config.apiKey) {
            throw new Error('Anthropic API key is required');
        }
        const anthropic = new Anthropic({ baseURL: config.baseUrl, apiKey: config.apiKey });
        return new AnthropicProvider(anthropic);
    }

    async listModels(): Promise<string[]> {
        const models = await this.anthropic.models.list();
        return models.data.map((model) => model.id);
    }

    async generateCompletion(params: {
        messages: { role: string; content: string }[];
        model: string;
        temperature?: number;
        n?: number;
    }): Promise<{ choices: { message: { content: string } }[] }> {
        const response = await this.anthropic.messages.create({
            model: params.model,
            max_tokens: 100,
            temperature: params.temperature ?? 0.7,
            messages: params.messages.map((msg) => {
                const role = msg.role === 'user' ? 'user' : 'assistant';
                return {
                    role,
                    content: msg.content,
                };
            }),
        });

        return {
            choices: [
                {
                    message: {
                        content: response.content[0].type === 'text' ? response.content[0].text : '',
                    },
                },
            ],
        };
    }

    async streamCompletion(params: {
        messages: { role: string; content: string }[];
        model: string;
        temperature?: number;
        onMessageDelta: (content: string) => void;
        onComplete: (finalContent: string) => void;
    }): Promise<void> {
        const stream = await this.anthropic.messages.create({
            model: params.model,
            max_tokens: 100,
            temperature: params.temperature ?? 0.7,
            messages: params.messages.map((msg) => {
                const role = msg.role === 'user' ? 'user' : 'assistant';
                return {
                    role,
                    content: msg.content,
                };
            }),
            stream: true,
        });

        let fullContent = '';

        for await (const chunk of stream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                const content = chunk.delta.text || '';
                fullContent += content;
                params.onMessageDelta(content);
            }
        }

        params.onComplete(fullContent);
    }
}
