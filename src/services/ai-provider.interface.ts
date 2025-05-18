export interface AIProvider {
    listModels(): Promise<string[]>;
    generateCompletion(params: {
        messages: { role: string; content: string }[];
        model: string;
        temperature?: number;
        n?: number;
    }): Promise<{ choices: { message: { content: string } }[] }>;
}

export const AIProviderSymbol = Symbol.for('AIProvider');
