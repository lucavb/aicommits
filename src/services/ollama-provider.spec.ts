import { OllamaProvider } from './ollama-provider';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('OllamaProvider', () => {
    const mockFetch = vi.fn();
    const baseUrl = 'http://localhost:11434';
    let provider: OllamaProvider;

    beforeEach(() => {
        mockFetch.mockClear();
        provider = new OllamaProvider(mockFetch, baseUrl);
    });

    describe('listModels', () => {
        it('should return list of model names', async () => {
            const mockResponse = {
                models: [
                    {
                        name: 'llama2',
                        modified_at: '2024-01-01',
                        size: 1000,
                        digest: 'abc123',
                        details: {
                            format: 'gguf',
                            family: 'llama',
                            families: ['llama'],
                            parameter_size: '7B',
                            quantization_level: 'Q4_0',
                        },
                    },
                    {
                        name: 'mistral',
                        modified_at: '2024-01-02',
                        size: 2000,
                        digest: 'def456',
                        details: {
                            format: 'gguf',
                            family: 'mistral',
                            families: ['mistral'],
                            parameter_size: '7B',
                            quantization_level: 'Q4_0',
                        },
                    },
                ],
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            });

            const result = await provider.listModels();

            expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/api/tags`);
            expect(result).toEqual(['llama2', 'mistral']);
        });

        it('should throw error when API call fails', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                statusText: 'Internal Server Error',
            });

            await expect(provider.listModels()).rejects.toThrow('Failed to fetch models: Internal Server Error');
        });
    });

    describe('generateCompletion', () => {
        it('should return completion response', async () => {
            const mockResponse = {
                response: 'This is a test response',
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            });

            const result = await provider.generateCompletion({
                messages: [
                    { role: 'user', content: 'Hello' },
                    { role: 'assistant', content: 'Hi there!' },
                ],
                model: 'llama2',
                temperature: 0.8,
            });

            expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama2',
                    options: { temperature: 0.8 },
                    prompt: 'user: Hello\nassistant: Hi there!',
                    stream: false,
                }),
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
            const mockResponse = {
                response: 'This is a test response',
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            });

            await provider.generateCompletion({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'llama2',
            });

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    body: expect.stringContaining('"temperature":0.7'),
                }),
            );
        });

        it('should throw error when API call fails', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                statusText: 'Internal Server Error',
            });

            await expect(
                provider.generateCompletion({
                    messages: [{ role: 'user', content: 'Hello' }],
                    model: 'llama2',
                }),
            ).rejects.toThrow('Failed to generate completion: Internal Server Error');
        });
    });
});
