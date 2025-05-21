import { OllamaProvider } from './ollama-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ollama } from 'ollama';

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
});
