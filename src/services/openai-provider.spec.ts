import { OpenAIProvider } from './openai-provider';
import { Model } from 'openai/resources/models';
import { ChatCompletion } from 'openai/resources/chat/completions';
import OpenAI from 'openai';

describe('OpenAIProvider', () => {
    let mockOpenAI: ConstructorParameters<typeof OpenAIProvider>[0];
    let provider: OpenAIProvider;

    beforeEach(() => {
        mockOpenAI = {
            chat: { completions: { create: jest.fn() } },
            models: { list: jest.fn() },
        } satisfies ConstructorParameters<typeof OpenAIProvider>[0];
        provider = new OpenAIProvider(mockOpenAI);
    });

    describe('listModels', () => {
        it('should return a list of model names', async () => {
            const mockModels: Model[] = [
                { id: 'gpt-3.5-turbo', created: 0, object: 'model' as const, owned_by: 'openai' },
                { id: 'gpt-4', created: 0, object: 'model' as const, owned_by: 'openai' },
                { id: 'dall-e', created: 0, object: 'model' as const, owned_by: 'openai' },
                { id: 'gpt-3.5-turbo-instruct', created: 0, object: 'model' as const, owned_by: 'openai' },
            ];
            jest.spyOn(mockOpenAI.models, 'list').mockResolvedValue({
                data: mockModels,
            } as unknown as ReturnType<InstanceType<typeof OpenAI>['models']['list']>);

            const result = await provider.listModels();

            expect(mockOpenAI.models.list).toHaveBeenCalled();
            expect(result).toEqual(['gpt-3.5-turbo', 'gpt-4', 'gpt-3.5-turbo-instruct']);
        });

        it('should throw an error if listing models fails', async () => {
            jest.spyOn(mockOpenAI.models, 'list').mockRejectedValue(new Error('Failed to list models'));

            await expect(provider.listModels()).rejects.toThrow('Failed to list models');
        });
    });

    describe('generateCompletion', () => {
        it('should return a completion response', async () => {
            const mockCompletion: ChatCompletion = {
                created: 0,
                id: 'test-id',
                model: 'gpt-3.5-turbo',
                object: 'chat.completion',
                choices: [
                    {
                        finish_reason: 'stop',
                        index: 0,
                        logprobs: null,
                        message: { content: 'This is a test response.', role: 'assistant', refusal: null },
                    },
                ],
            };
            jest.spyOn(mockOpenAI.chat.completions, 'create').mockResolvedValue(mockCompletion);

            const result = await provider.generateCompletion({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'gpt-3.5-turbo',
                temperature: 0.7,
            });

            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
                frequency_penalty: 0,
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'gpt-3.5-turbo',
                n: 1,
                presence_penalty: 0,
                temperature: 0.7,
                top_p: 1,
            });
            expect(result).toEqual({
                choices: [{ message: { content: 'This is a test response.' } }],
            });
        });

        it('should throw an error if generating completion fails', async () => {
            jest.spyOn(mockOpenAI.chat.completions, 'create').mockRejectedValue(
                new Error('Failed to generate completion'),
            );

            await expect(
                provider.generateCompletion({
                    messages: [{ role: 'user', content: 'Hello' }],
                    model: 'gpt-3.5-turbo',
                }),
            ).rejects.toThrow('Failed to generate completion');
        });
    });
});
