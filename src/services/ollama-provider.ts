import { ConfigService } from './config.service';
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

export class OllamaProvider implements AIProvider {
    private baseUrl: string;

    constructor(private readonly configService: ConfigService) {
        // Initialize with default URL, will be updated in initialize()
        this.baseUrl = 'http://localhost:11434';
    }

    async initialize(): Promise<void> {
        const config = await this.configService.readConfig();
        if (!config.baseUrl) {
            throw new Error('Base URL is required in configuration');
        }
        this.baseUrl = config.baseUrl;
    }

    async listModels(): Promise<string[]> {
        const response = await fetch(`${this.baseUrl}/api/tags`);
        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.statusText}`);
        }
        const data = await response.json();
        return data.models.map((m: OllamaModel) => m.name);
    }

    async generateCompletion(params: {
        messages: { role: string; content: string }[];
        model: string;
        temperature?: number;
        n?: number;
    }): Promise<{ choices: { message: { content: string } }[] }> {
        // Convert messages to a single prompt
        const prompt = params.messages.map((m) => `${m.role}: ${m.content}`).join('\n');

        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: params.model,
                prompt,
                stream: false,
                options: {
                    temperature: params.temperature,
                },
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
