import { OllamaProvider } from './ollama-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ollama } from 'ollama';

// Define a type for our mock chunks and stream
type MockOllamaChunk = {
    message: {
        content: string;
    };
};

type MockOllamaStream = {
    [Symbol.asyncIterator](): AsyncGenerator<MockOllamaChunk, void, unknown>;
};

describe('OllamaProvider', () => {
    let mockOllama: ConstructorParameters<typeof OllamaProvider>[0];
    let provider: OllamaProvider;

    beforeEach(() => {
        mockOllama = {
            list: vi.fn(),
            chat: vi.fn(),
        };

        provider = new OllamaProvider(mockOllama);
    });

    describe('listModels', () => {
        it('should return list of model names', async () => {
            const mockModels = [{ name: 'llama2' }, { name: 'mistral' }];

            vi.spyOn(mockOllama, 'list').mockResolvedValue({
                models: mockModels,
            } as unknown as Awaited<ReturnType<Ollama['list']>>);

            const result = await provider.listModels();

            expect(mockOllama.list).toHaveBeenCalled();
            expect(result).toEqual(['llama2', 'mistral']);
        });

        it('should throw error when API call fails', async () => {
            vi.spyOn(mockOllama, 'list').mockRejectedValue(new Error('Failed to list models'));

            await expect(provider.listModels()).rejects.toThrow();
        });
    });

    describe('generateCompletion', () => {
        it('should return completion response', async () => {
            const messages = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there!' },
            ];

            vi.spyOn(mockOllama, 'chat').mockResolvedValue({
                message: {
                    role: 'assistant',
                    content: 'This is a test response',
                },
            } as unknown as Awaited<ReturnType<Ollama['chat']>>);

            const result = await provider.generateCompletion({
                messages,
                model: 'llama2',
                temperature: 0.8,
            });

            expect(mockOllama.chat).toHaveBeenCalledWith({
                model: 'llama2',
                messages,
                options: { temperature: 0.8 },
            });

            expect(result).toEqual({
                choices: [
                    {
                        message: {
                            content: 'This is a test response',
                        },
                    },
                ],
            });
        });

        it('should use default temperature when not provided', async () => {
            const messages = [{ role: 'user', content: 'Hello' }];

            vi.spyOn(mockOllama, 'chat').mockResolvedValue({
                message: {
                    role: 'assistant',
                    content: 'This is a test response',
                },
            } as unknown as Awaited<ReturnType<Ollama['chat']>>);

            await provider.generateCompletion({
                messages,
                model: 'llama2',
            });

            expect(mockOllama.chat).toHaveBeenCalledWith({
                model: 'llama2',
                messages,
                options: { temperature: 0.7 },
            });
        });

        it('should throw error when API call fails', async () => {
            vi.spyOn(mockOllama, 'chat').mockRejectedValue(new Error('Failed to generate completion'));

            await expect(
                provider.generateCompletion({
                    messages: [{ role: 'user', content: 'Hello' }],
                    model: 'llama2',
                }),
            ).rejects.toThrow();
        });
    });

    describe('streamCompletion', () => {
        it('should stream completion chunks and call callbacks correctly', async () => {
            const messages = [{ role: 'user', content: 'Hello' }];

            // Mock stream response with incrementally growing content
            const mockChunks = [
                { message: { content: 'H' } },
                { message: { content: 'He' } },
                { message: { content: 'Hel' } },
                { message: { content: 'Hell' } },
                { message: { content: 'Hello' } },
                { message: { content: 'Hello!' } },
            ];

            // Create mock async iterator with strongly-typed iterables
            const mockStream: MockOllamaStream = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of mockChunks) {
                        yield chunk;
                    }
                },
            };

            vi.spyOn(mockOllama, 'chat').mockResolvedValue(
                mockStream as unknown as Awaited<ReturnType<Ollama['chat']>>,
            );

            const onMessageDelta = vi.fn();
            const onComplete = vi.fn();

            await provider.streamCompletion({
                messages,
                model: 'llama2',
                temperature: 0.8,
                onMessageDelta,
                onComplete,
            });

            // Verify chat was called with stream: true
            expect(mockOllama.chat).toHaveBeenCalledWith({
                model: 'llama2',
                messages,
                options: { temperature: 0.8 },
                stream: true,
            });

            // Verify delta callbacks - the number should match the actual implementation behavior
            expect(onMessageDelta).toHaveBeenCalledTimes(6); // Updated to match implementation behavior
            expect(onMessageDelta).toHaveBeenNthCalledWith(1, 'H');
            expect(onMessageDelta).toHaveBeenNthCalledWith(2, 'e');
            expect(onMessageDelta).toHaveBeenNthCalledWith(3, 'l');
            expect(onMessageDelta).toHaveBeenNthCalledWith(4, 'l');
            expect(onMessageDelta).toHaveBeenNthCalledWith(5, 'o');
            expect(onMessageDelta).toHaveBeenNthCalledWith(6, '!');

            // Verify final callback
            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(onComplete).toHaveBeenCalledWith('Hello!');
        });

        it('should handle chunks with identical content', async () => {
            // Testing when Ollama returns the same content for multiple chunks
            const mockChunks = [
                { message: { content: 'Hello' } },
                { message: { content: 'Hello' } }, // Same content
                { message: { content: 'Hello!' } },
            ];

            const mockStream: MockOllamaStream = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of mockChunks) {
                        yield chunk;
                    }
                },
            };

            vi.spyOn(mockOllama, 'chat').mockResolvedValue(
                mockStream as unknown as Awaited<ReturnType<Ollama['chat']>>,
            );

            const onMessageDelta = vi.fn();
            const onComplete = vi.fn();

            await provider.streamCompletion({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'llama2',
                onMessageDelta,
                onComplete,
            });

            // Should emit only for non-whitespace chunks (filters empty deltas)
            expect(onMessageDelta).toHaveBeenCalledTimes(2);
            expect(onMessageDelta).toHaveBeenNthCalledWith(1, 'Hello');
            expect(onMessageDelta).toHaveBeenNthCalledWith(2, '!');

            expect(onComplete).toHaveBeenCalledWith('Hello!');
        });

        it('should use default temperature when not provided', async () => {
            const mockStream: MockOllamaStream = {
                async *[Symbol.asyncIterator]() {
                    yield { message: { content: 'Hello' } };
                },
            };

            vi.spyOn(mockOllama, 'chat').mockResolvedValue(
                mockStream as unknown as Awaited<ReturnType<Ollama['chat']>>,
            );

            await provider.streamCompletion({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'llama2',
                onMessageDelta: () => {},
                onComplete: () => {},
            });

            expect(mockOllama.chat).toHaveBeenCalledWith({
                model: 'llama2',
                messages: [{ role: 'user', content: 'Hello' }],
                options: { temperature: 0.7 },
                stream: true,
            });
        });

        it('should throw error when API call fails', async () => {
            vi.spyOn(mockOllama, 'chat').mockRejectedValue(new Error('Failed to stream completion'));

            const onMessageDelta = vi.fn();
            const onComplete = vi.fn();

            await expect(
                provider.streamCompletion({
                    messages: [{ role: 'user', content: 'Hello' }],
                    model: 'llama2',
                    onMessageDelta,
                    onComplete,
                }),
            ).rejects.toThrow();

            // Callbacks should not have been called
            expect(onMessageDelta).not.toHaveBeenCalled();
            expect(onComplete).not.toHaveBeenCalled();
        });
    });
});
