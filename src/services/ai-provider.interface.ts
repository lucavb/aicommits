export interface AIProvider {
    listModels(): Promise<string[]>;
    generateCompletion(params: {
        messages: { role: string; content: string }[];
        model: string;
        temperature?: number;
        n?: number;
    }): Promise<{ choices: { message: { content: string } }[] }>;
}

export interface AIProviderFactory {
    createProvider(config: { baseUrl: string; apiKey?: string }): AIProvider;
}

export const AIProviderFactorySymbol = Symbol.for('AIProviderFactory');
