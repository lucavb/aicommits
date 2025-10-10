import { OpenAIProvider } from './openai-provider';
import { Model } from 'openai/resources/models';

import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Stream } from 'openai/streaming';
import { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions/completions';

describe('OpenAIProvider', () => {
    let mockOpenAI: ConstructorParameters<typeof OpenAIProvider>[0];
    let provider: OpenAIProvider;

    beforeEach(() => {
        mockOpenAI = {
            chat: { completions: { create: vi.fn() } },
            models: { list: vi.fn() },
        } satisfies ConstructorParameters<typeof OpenAIProvider>[0];
        provider = new OpenAIProvider(mockOpenAI);
    });

    describe('listModels', () => {
        it('should return a list of model names including reasoning models', async () => {
            const mockModels: Model[] = [
                { id: 'gpt-3.5-turbo', created: 0, object: 'model' as const, owned_by: 'openai' },
                { id: 'gpt-4', created: 0, object: 'model' as const, owned_by: 'openai' },
                { id: 'dall-e', created: 0, object: 'model' as const, owned_by: 'openai' },
                { id: 'gpt-3.5-turbo-instruct', created: 0, object: 'model' as const, owned_by: 'openai' },
                { id: 'o1-preview', created: 0, object: 'model' as const, owned_by: 'openai' },
                { id: 'o1-mini', created: 0, object: 'model' as const, owned_by: 'openai' },
                { id: 'o3-mini', created: 0, object: 'model' as const, owned_by: 'openai' },
            ];
            vi.spyOn(mockOpenAI.models, 'list').mockResolvedValue({
                data: mockModels,
            } as unknown as Awaited<ReturnType<InstanceType<typeof OpenAI>['models']['list']>>);

            const result = await provider.listModels();

            expect(mockOpenAI.models.list).toHaveBeenCalled();
            expect(result).toEqual(['gpt-3.5-turbo', 'gpt-4', 'gpt-3.5-turbo-instruct', 'o1-preview', 'o1-mini', 'o3-mini']);
        });

        it('should throw an error if listing models fails', async () => {
            vi.spyOn(mockOpenAI.models, 'list').mockRejectedValue(new Error('Failed to list models'));

            await expect(provider.listModels()).rejects.toThrow('Failed to list models');
        });
    });

    describe('generateCompletion', () => {
        it('should return a completion response', async () => {
            const mockCompletion = {
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
            } as const satisfies ChatCompletion;
            vi.spyOn(mockOpenAI.chat.completions, 'create').mockResolvedValue(mockCompletion);

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

        it('should handle reasoning models (o1) without temperature and with reasoning_effort', async () => {
            const mockCompletion = {
                created: 0,
                id: 'test-id',
                model: 'o1-preview',
                object: 'chat.completion',
                choices: [
                    {
                        finish_reason: 'stop',
                        index: 0,
                        logprobs: null,
                        message: { content: 'This is a reasoning response.', role: 'assistant', refusal: null },
                    },
                ],
            } as const satisfies ChatCompletion;
            vi.spyOn(mockOpenAI.chat.completions, 'create').mockResolvedValue(mockCompletion);

            const result = await provider.generateCompletion({
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'Solve this problem' },
                ],
                model: 'o1-preview',
                reasoningEffort: 'high',
            });

            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
                messages: [
                    { role: 'user', content: 'System instructions: You are a helpful assistant.' },
                    { role: 'user', content: 'Solve this problem' },
                ],
                model: 'o1-preview',
                n: 1,
                reasoning_effort: 'high',
            });
            expect(result).toEqual({
                choices: [{ message: { content: 'This is a reasoning response.' } }],
            });
        });

        it('should handle o3 models as reasoning models', async () => {
            const mockCompletion = {
                created: 0,
                id: 'test-id',
                model: 'o3-mini',
                object: 'chat.completion',
                choices: [
                    {
                        finish_reason: 'stop',
                        index: 0,
                        logprobs: null,
                        message: { content: 'O3 response.', role: 'assistant', refusal: null },
                    },
                ],
            } as const satisfies ChatCompletion;
            vi.spyOn(mockOpenAI.chat.completions, 'create').mockResolvedValue(mockCompletion);

            const result = await provider.generateCompletion({
                messages: [{ role: 'system', content: 'System prompt' }, { role: 'user', content: 'User prompt' }],
                model: 'o3-mini',
                reasoningEffort: 'medium',
            });

            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
                messages: [
                    { role: 'user', content: 'System instructions: System prompt' },
                    { role: 'user', content: 'User prompt' },
                ],
                model: 'o3-mini',
                n: 1,
                reasoning_effort: 'medium',
            });
            expect(result).toEqual({
                choices: [{ message: { content: 'O3 response.' } }],
            });
        });

        it('should handle reasoning models without reasoning_effort parameter', async () => {
            const mockCompletion = {
                created: 0,
                id: 'test-id',
                model: 'o1-mini',
                object: 'chat.completion',
                choices: [
                    {
                        finish_reason: 'stop',
                        index: 0,
                        logprobs: null,
                        message: { content: 'Response.', role: 'assistant', refusal: null },
                    },
                ],
            } as const satisfies ChatCompletion;
            vi.spyOn(mockOpenAI.chat.completions, 'create').mockResolvedValue(mockCompletion);

            const result = await provider.generateCompletion({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'o1-mini',
            });

            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'o1-mini',
                n: 1,
            });
            expect(result).toEqual({
                choices: [{ message: { content: 'Response.' } }],
            });
        });

        it('should throw an error if generating completion fails', async () => {
            vi.spyOn(mockOpenAI.chat.completions, 'create').mockRejectedValue(
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

    describe('streamCompletion', () => {
        it('should stream completion chunks and call callbacks correctly', async () => {
            // Create mock async iterator
            const mockChunks = [
                { choices: [{ delta: { content: 'Hello' } }] },
                { choices: [{ delta: { content: ' world' } }] },
                { choices: [{ delta: { content: '!' } }] },
            ];

            // Create a more complete mock that satisfies the Stream type
            const mockStream = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of mockChunks) {
                        yield chunk as ChatCompletionChunk;
                    }
                },
            } as unknown as Stream<ChatCompletionChunk>;

            vi.spyOn(mockOpenAI.chat.completions, 'create').mockResolvedValue(mockStream);

            const onMessageDelta = vi.fn();
            const onComplete = vi.fn();

            await provider.streamCompletion({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'gpt-3.5-turbo',
                temperature: 0.7,
                onMessageDelta,
                onComplete,
            });

            // Verify the chat.completions.create was called with stream: true
            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
                frequency_penalty: 0,
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'gpt-3.5-turbo',
                presence_penalty: 0,
                temperature: 0.7,
                top_p: 1,
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

        it('should handle chunks with no content', async () => {
            const mockChunks = [
                { choices: [{ delta: { content: 'Hello' } }] },
                { choices: [{ delta: {} }] }, // No content
                { choices: [{ delta: { content: '!' } }] },
            ];

            // Create a more complete mock that satisfies the Stream type
            const mockStream = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of mockChunks) {
                        yield chunk as ChatCompletionChunk;
                    }
                },
            } as unknown as Stream<ChatCompletionChunk>;

            vi.spyOn(mockOpenAI.chat.completions, 'create').mockResolvedValue(mockStream);

            const onMessageDelta = vi.fn();
            const onComplete = vi.fn();

            await provider.streamCompletion({
                messages: [{ role: 'user', content: 'Hello' }],
                model: 'gpt-3.5-turbo',
                onMessageDelta,
                onComplete,
            });

            // Verify onMessageDelta was called only for chunks with content
            expect(onMessageDelta).toHaveBeenCalledTimes(2);
            expect(onMessageDelta).toHaveBeenNthCalledWith(1, 'Hello');
            expect(onMessageDelta).toHaveBeenNthCalledWith(2, '!');

            // Verify onComplete was called with the full content
            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(onComplete).toHaveBeenCalledWith('Hello!');
        });

        it('should throw an error if streaming fails', async () => {
            vi.spyOn(mockOpenAI.chat.completions, 'create').mockRejectedValue(new Error('Failed to stream completion'));

            const onMessageDelta = vi.fn();
            const onComplete = vi.fn();

            await expect(
                provider.streamCompletion({
                    messages: [{ role: 'user', content: 'Hello' }],
                    model: 'gpt-3.5-turbo',
                    onMessageDelta,
                    onComplete,
                }),
            ).rejects.toThrow('Failed to stream completion');

            // Callbacks should not have been called
            expect(onMessageDelta).not.toHaveBeenCalled();
            expect(onComplete).not.toHaveBeenCalled();
        });

        it('should handle reasoning model streaming with reasoning_effort', async () => {
            const mockChunks = [
                { choices: [{ delta: { content: 'Thinking' } }] },
                { choices: [{ delta: { content: '...' } }] },
                { choices: [{ delta: { content: ' done!' } }] },
            ];

            const mockStream = {
                async *[Symbol.asyncIterator]() {
                    for (const chunk of mockChunks) {
                        yield chunk as ChatCompletionChunk;
                    }
                },
            } as unknown as Stream<ChatCompletionChunk>;

            vi.spyOn(mockOpenAI.chat.completions, 'create').mockResolvedValue(mockStream);

            const onMessageDelta = vi.fn();
            const onComplete = vi.fn();

            await provider.streamCompletion({
                messages: [
                    { role: 'system', content: 'Be helpful' },
                    { role: 'user', content: 'Reason about this' },
                ],
                model: 'o1-preview',
                reasoningEffort: 'high',
                onMessageDelta,
                onComplete,
            });

            expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
                messages: [
                    { role: 'user', content: 'System instructions: Be helpful' },
                    { role: 'user', content: 'Reason about this' },
                ],
                model: 'o1-preview',
                stream: true,
                reasoning_effort: 'high',
            });

            expect(onMessageDelta).toHaveBeenCalledTimes(3);
            expect(onComplete).toHaveBeenCalledWith('Thinking... done!');
        });
    });
});
