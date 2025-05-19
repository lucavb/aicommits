import { AnthropicProvider } from './anthropic-provider';
import Anthropic from '@anthropic-ai/sdk';

describe('AnthropicProvider', () => {
    let mockAnthropic: ConstructorParameters<typeof AnthropicProvider>[0];
    let provider: AnthropicProvider;

    beforeEach(() => {
        mockAnthropic = {
            messages: { create: jest.fn() },
            models: { list: jest.fn() },
        } satisfies ConstructorParameters<typeof AnthropicProvider>[0];
        provider = new AnthropicProvider(mockAnthropic);
    });

    describe('listModels', () => {
        it('should return a list of model names', async () => {
            const mockModels = [
                { id: 'claude-3-opus-20240229', created: 0, object: 'model' as const },
                { id: 'claude-3-sonnet-20240229', created: 0, object: 'model' as const },
            ];
            jest.spyOn(mockAnthropic.models, 'list').mockResolvedValue({
                data: mockModels,
            } as unknown as ReturnType<InstanceType<typeof Anthropic>['models']['list']>);

            const result = await provider.listModels();

            expect(mockAnthropic.models.list).toHaveBeenCalled();
            expect(result).toEqual(['claude-3-opus-20240229', 'claude-3-sonnet-20240229']);
        });

        it('should throw an error if listing models fails', async () => {
            jest.spyOn(mockAnthropic.models, 'list').mockRejectedValue(new Error('Failed to list models'));

            await expect(provider.listModels()).rejects.toThrow('Failed to list models');
        });
    });

    describe('generateCompletion', () => {
        it('should return a completion response', async () => {
            const mockResponse = {
                id: 'test-id',
                model: 'claude-3-opus-20240229',
                type: 'message' as const,
                role: 'assistant' as const,
                content: [{ type: 'text' as const, text: 'This is a test response.', citations: [] }],
                stop_reason: 'end_turn' as const,
                stop_sequence: null,
                usage: {
                    input_tokens: 10,
                    output_tokens: 20,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                    server_tool_use: { web_search_requests: 0 },
                },
            };
            jest.spyOn(mockAnthropic.messages, 'create').mockResolvedValue(mockResponse);

            const result = await provider.generateCompletion({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'claude-3-opus-20240229',
                temperature: 0.7,
            });

            expect(mockAnthropic.messages.create).toHaveBeenCalledWith({
                model: 'claude-3-opus-20240229',
                max_tokens: 100,
                temperature: 0.7,
                messages: [{ role: 'user', content: 'Hello' }],
            });
            expect(result).toEqual({
                choices: [{ message: { content: 'This is a test response.' } }],
            });
        });

        it('should throw an error if generating completion fails', async () => {
            jest.spyOn(mockAnthropic.messages, 'create').mockRejectedValue(new Error('Failed to generate completion'));

            await expect(
                provider.generateCompletion({
                    messages: [{ role: 'user', content: 'Hello' }],
                    model: 'claude-3-opus-20240229',
                }),
            ).rejects.toThrow('Failed to generate completion');
        });
    });
});
