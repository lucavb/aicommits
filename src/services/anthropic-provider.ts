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
}
