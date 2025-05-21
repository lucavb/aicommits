import { AnthropicProvider } from './anthropic-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Define types for mock streams
type MockAnthropicChunk = 
  | { type: 'content_block_delta'; delta: { type: 'text_delta'; text: string } }
  | { type: 'message_start' }
  | { type: 'message_stop' };

type MockAnthropicStream = {
  [Symbol.asyncIterator](): AsyncGenerator<MockAnthropicChunk, void, unknown>;
};

describe('AnthropicProvider', () => {
    let mockAnthropic: ConstructorParameters<typeof AnthropicProvider>[0];
    let provider: AnthropicProvider;

    beforeEach(() => {
        mockAnthropic = {
            messages: { create: vi.fn() },
            models: { list: vi.fn() },
        } satisfies ConstructorParameters<typeof AnthropicProvider>[0];
        provider = new AnthropicProvider(mockAnthropic);
    });

    describe('listModels', () => {
        it('should return a list of model names', async () => {
            const mockModels = [
                { id: 'claude-3-opus-20240229', created: 0, object: 'model' as const },
                { id: 'claude-3-sonnet-20240229', created: 0, object: 'model' as const },
            ];
            vi.spyOn(mockAnthropic.models, 'list').mockResolvedValue({
                data: mockModels,
            } as unknown as Awaited<ReturnType<typeof mockAnthropic.models.list>>);

            const result = await provider.listModels();

            expect(mockAnthropic.models.list).toHaveBeenCalled();
            expect(result).toEqual(['claude-3-opus-20240229', 'claude-3-sonnet-20240229']);
        });

        it('should throw an error if listing models fails', async () => {
            vi.spyOn(mockAnthropic.models, 'list').mockRejectedValue(new Error('Failed to list models'));

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
            vi.spyOn(mockAnthropic.messages, 'create').mockResolvedValue(mockResponse);

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
            vi.spyOn(mockAnthropic.messages, 'create').mockRejectedValue(new Error('Failed to generate completion'));

            await expect(
                provider.generateCompletion({
                    messages: [{ role: 'user', content: 'Hello' }],
                    model: 'claude-3-opus-20240229',
                }),
            ).rejects.toThrow('Failed to generate completion');
        });
    });

    describe('streamCompletion', () => {
        it('should stream completion chunks and call callbacks correctly', async () => {
            // Mock chunks for streaming
            const mockChunks: MockAnthropicChunk[] = [
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
                { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
                { type: 'content_block_delta', delta: { type: 'text_delta', text: '!' } },
                { type: 'message_stop' }, // End of stream marker
            ];

            // Create mock async iterator
            const mockStream: MockAnthropicStream = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of mockChunks) {
                        yield chunk;
                    }
                },
            };

            // Type-safe mock for Anthropic's stream
            vi.spyOn(mockAnthropic.messages, 'create').mockResolvedValue(mockStream as unknown as Awaited<ReturnType<typeof mockAnthropic.messages.create>>);

            const onMessageDelta = vi.fn();
            const onComplete = vi.fn();

            await provider.streamCompletion({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'claude-3-opus-20240229',
                temperature: 0.7,
                onMessageDelta,
                onComplete,
            });

            // Verify the messages.create was called with stream: true
            expect(mockAnthropic.messages.create).toHaveBeenCalledWith({
                model: 'claude-3-opus-20240229',
                max_tokens: 100,
                temperature: 0.7,
                messages: [{ role: 'user', content: 'Hello' }],
                stream: true,
            });

            // Verify onMessageDelta was called for each content chunk
            expect(onMessageDelta).toHaveBeenCalledTimes(3);
            expect(onMessageDelta).toHaveBeenNthCalledWith(1, 'Hello');
            expect(onMessageDelta).toHaveBeenNthCalledWith(2, ' world');
            expect(onMessageDelta).toHaveBeenNthCalledWith(3, '!');

            // Verify onComplete was called once with the full content
            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(onComplete).toHaveBeenCalledWith('Hello world!');
        });

        it('should handle non-text chunks', async () => {
            const mockChunks: MockAnthropicChunk[] = [
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
                { type: 'message_start' }, // Not a text chunk
                { type: 'content_block_delta', delta: { type: 'text_delta', text: '!' } },
                { type: 'message_stop' },
            ];

            const mockStream: MockAnthropicStream = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of mockChunks) {
                        yield chunk;
                    }
                },
            };

            // Type-safe mock for Anthropic's stream
            vi.spyOn(mockAnthropic.messages, 'create').mockResolvedValue(mockStream as unknown as Awaited<ReturnType<typeof mockAnthropic.messages.create>>);

            const onMessageDelta = vi.fn();
            const onComplete = vi.fn();

            await provider.streamCompletion({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'claude-3-opus-20240229',
                onMessageDelta,
                onComplete,
            });

            // Verify onMessageDelta was called only for text chunks
            expect(onMessageDelta).toHaveBeenCalledTimes(2);
            expect(onMessageDelta).toHaveBeenNthCalledWith(1, 'Hello');
            expect(onMessageDelta).toHaveBeenNthCalledWith(2, '!');

            // Verify onComplete was called with the full content
            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(onComplete).toHaveBeenCalledWith('Hello!');
        });

        it('should throw an error if streaming fails', async () => {
            vi.spyOn(mockAnthropic.messages, 'create').mockRejectedValue(new Error('Failed to stream completion'));

            const onMessageDelta = vi.fn();
            const onComplete = vi.fn();

            await expect(
                provider.streamCompletion({
                    messages: [{ role: 'user', content: 'Hello' }],
                    model: 'claude-3-opus-20240229',
                    onMessageDelta,
                    onComplete,
                }),
            ).rejects.toThrow('Failed to stream completion');

            // Callbacks should not have been called
            expect(onMessageDelta).not.toHaveBeenCalled();
            expect(onComplete).not.toHaveBeenCalled();
        });
    });
});
