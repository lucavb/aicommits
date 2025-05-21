export interface AIProvider {
    listModels(): Promise<string[]>;
    generateCompletion(params: {
        messages: { role: string; content: string }[];
        model: string;
        temperature?: number;
        n?: number;
    }): Promise<{ choices: { message: { content: string } }[] }>;

    streamCompletion(params: {
        messages: { role: string; content: string }[];
        model: string;
        onComplete: (finalContent: string) => void;
        onMessageDelta: (content: string) => void;
        temperature?: number;
    }): Promise<void>;
}

export const AIProviderSymbol = Symbol.for('AIProvider');
