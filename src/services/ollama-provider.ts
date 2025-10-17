import { AIProvider, ReasoningEffort } from './ai-provider.interface';
import { Ollama } from 'ollama';
import { Inject, Injectable } from '../utils/inversify';

@Injectable()
export class OllamaProvider implements AIProvider {
    constructor(@Inject(Ollama) private readonly ollama: Pick<Ollama, 'list' | 'chat'>) {}

    static create(config: { baseUrl?: string }): OllamaProvider {
        const ollama = new Ollama({ host: config.baseUrl || 'http://localhost:11434' });
        return new OllamaProvider(ollama);
    }

    async listModels(): Promise<string[]> {
        const response = await this.ollama.list();
        return response.models.map((model) => model.name);
    }

    async generateCompletion({
        messages,
        model,
        temperature = 0.7,
        reasoningEffort: _reasoningEffort,
    }: {
        messages: { role: string; content: string }[];
        model: string;
        temperature?: number;
        reasoningEffort?: ReasoningEffort;
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

    async streamCompletion(params: {
        messages: { role: string; content: string }[];
        model: string;
        temperature?: number;
        onMessageDelta: (content: string) => void;
        onComplete: (finalContent: string) => void;
        reasoningEffort?: ReasoningEffort;
    }): Promise<void> {
        let fullContent = '';

        const stream = await this.ollama.chat({
            messages: params.messages,
            model: params.model,
            options: { temperature: params.temperature ?? 0.7 },
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.message.content;
            // Extract just the new content by removing what we've already seen
            const newContent = content.substring(fullContent.length);
            fullContent = content;
            if (newContent.trim()) {
                params.onMessageDelta(newContent);
            }
        }

        params.onComplete(fullContent);
    }
}
