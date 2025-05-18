import { AIProvider } from './ai-provider.interface';

export interface OllamaModel {
    name: string;
    modified_at: string;
    size: number;
    digest: string;
    details: {
        format: string;
        family: string;
        families: string[];
        parameter_size: string;
        quantization_level: string;
    };
}

type Fetch = typeof fetch;

export class OllamaProvider implements AIProvider {
    constructor(
        private readonly fetch: Fetch,
        private readonly baseUrl: string,
    ) {}

    async listModels(): Promise<string[]> {
        const response = await this.fetch(`${this.baseUrl}/api/tags`);
        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.statusText}`);
        }
        const data = await response.json();
        return data.models.map((m: OllamaModel) => m.name);
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
        const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n');

        const response = await this.fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                options: { temperature: temperature },
                prompt,
                stream: false,
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to generate completion: ${response.statusText}`);
        }

        const data = await response.json();
        return {
            choices: [
                {
                    message: {
                        content: data.response,
                    },
                },
            ],
        };
    }
}
