import { AIProvider } from './ai-provider.interface';
import { Ollama } from 'ollama';
import { Inject, Injectable } from '../utils/inversify';

@Injectable()
export class OllamaProvider implements AIProvider {
    constructor(@Inject(Ollama) private readonly ollama: Pick<Ollama, 'list' | 'chat'>) {}

    async listModels(): Promise<string[]> {
        const response = await this.ollama.list();
        return response.models.map((model) => model.name);
    }

    async generateCompletion({
        messages,
        model,
        temperature = 0.7,
    }: {
        messages: { role: string; content: string }[];
        model: string;
        temperature?: number;
    }): Promise<{ choices: { message: { content: string } }[] }> {
        const response = await this.ollama.chat({
            model,
            messages,
            options: { temperature },
        });

        return {
            choices: [
                {
                    message: {
                        content: response.message.content,
                    },
                },
            ],
        };
    }
}
