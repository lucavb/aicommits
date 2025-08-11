import 'reflect-metadata';
import { Container } from 'inversify';
import { AICommitMessageService } from './ai-commit-message.service';

import { PromptService } from './prompt.service';
import { ConfigService } from './config.service';
import { Injectable } from '../utils/inversify';
import { AIProviderFactory } from './ai-provider.factory';
import { describe, it, expect, beforeEach, vi } from 'vitest';

@Injectable()
class MockConfigService implements Partial<ConfigService> {
    getConfig = vi.fn();
}

@Injectable()
class MockPromptService implements Partial<PromptService> {
    generateCommitMessagePrompt = vi.fn().mockReturnValue('generateCommitMessagePrompt');
    generateSummaryPrompt = vi.fn().mockReturnValue('generateSummaryPrompt');
    getCommitMessageSystemPrompt = vi
        .fn()
        .mockReturnValue(
            'You are a git commit message generator. Your task is to write clear, concise, and descriptive commit messages that follow best practices. Always use the imperative mood and focus on the intent and impact of the change. Do not include file names, code snippets, or unnecessary details. Never include explanations, commentary, or formatting outside the commit message itself.',
        );
}

@Injectable()
class MockAIProvider {
    generateCompletion = vi.fn();
    listModels = vi.fn();
    streamCompletion = vi.fn();
}

@Injectable()
class MockAIProviderFactory implements Partial<AIProviderFactory> {
    createProvider = vi.fn();
}

describe('AICommitMessageService', () => {
    let configService: MockConfigService;
    let promptService: MockPromptService;
    let service: AICommitMessageService;
    let aiProvider: MockAIProvider;
    let aiProviderFactory: MockAIProviderFactory;

    beforeEach(() => {
        // Create shared mock instances
        aiProvider = new MockAIProvider();
        aiProviderFactory = new MockAIProviderFactory();
        aiProviderFactory.createProvider.mockReturnValue(aiProvider);

        const container = new Container({ defaultScope: 'Singleton' });
        container.bind(ConfigService).to(MockConfigService as unknown as typeof ConfigService);
        container.bind(PromptService).to(MockPromptService as unknown as typeof PromptService);
        container.bind(AIProviderFactory).toDynamicValue(() => aiProviderFactory as unknown as AIProviderFactory);
        container.bind(AICommitMessageService).toSelf();

        configService = container.get<MockConfigService>(ConfigService as unknown as typeof MockConfigService);
        promptService = container.get<MockPromptService>(PromptService as unknown as typeof MockPromptService);
        service = container.get(AICommitMessageService);
    });

    it('can be composed', () => {
        expect(service).toBeTruthy();
    });

    it('should generate commit messages and bodies', async () => {
        const diff = 'some diff';
        const config = {
            locale: 'en',
            maxLength: 50,
            model: 'gpt-3.5-turbo',
            type: 'feat',
        };

        configService.getConfig.mockReturnValue(config);

        aiProvider.generateCompletion
            .mockResolvedValueOnce({
                choices: [{ message: { content: 'Commit message 1.' } }, { message: { content: 'Commit message 2.' } }],
            })
            .mockResolvedValueOnce({
                choices: [{ message: { content: 'Summary 1' } }, { message: { content: 'Summary 2' } }],
            });

        const result = await service.generateCommitMessage({ diff });

        expect(result).toEqual({
            commitMessages: ['Commit message 1', 'Commit message 2'],
            bodies: ['Summary 1', 'Summary 2'],
        });

        expect(configService.getConfig).toHaveBeenCalledTimes(1);
        expect(promptService.generateCommitMessagePrompt).toHaveBeenCalledWith('en', 50, 'feat');
        expect(promptService.generateSummaryPrompt).toHaveBeenCalledWith('en');
    });

    describe('generateStreamingCommitMessage', () => {
        it('should stream commit message with callbacks', async () => {
            const diff = 'some diff';
            const config = {
                locale: 'en',
                maxLength: 50,
                model: 'gpt-3.5-turbo',
                type: 'feat',
            };

            configService.getConfig.mockReturnValue(config);

            // Mock implementation to simulate streaming completion
            // First we capture the callbacks to call them manually
            let messageCallback: ((content: string) => void) | undefined;
            let messageCompleteCallback: ((finalContent: string) => void) | undefined;
            let bodyCallback: ((content: string) => void) | undefined;
            let bodyCompleteCallback: ((finalContent: string) => void) | undefined;

            aiProvider.streamCompletion.mockImplementation((params) => {
                // Store callbacks based on the message content to identify which stream is which
                if (params.messages.some((m: { content: string }) => m.content === 'generateCommitMessagePrompt')) {
                    messageCallback = params.onMessageDelta;
                    messageCompleteCallback = params.onComplete;
                } else {
                    bodyCallback = params.onMessageDelta;
                    bodyCompleteCallback = params.onComplete;
                }
                return Promise.resolve();
            });

            const onMessageUpdate = vi.fn();
            const onBodyUpdate = vi.fn();
            const onComplete = vi.fn();

            // Start streaming - this won't complete immediately
            const streamPromise = service.generateStreamingCommitMessage({
                diff,
                onMessageUpdate,
                onBodyUpdate,
                onComplete,
            });

            // Ensure callbacks are defined before using them
            expect(messageCallback).toBeDefined();
            expect(messageCompleteCallback).toBeDefined();
            expect(bodyCallback).toBeDefined();
            expect(bodyCompleteCallback).toBeDefined();

            // Now we can safely use them with the non-null assertion operator
            // Simulate message streaming by calling callbacks
            messageCallback!('Add ');
            messageCallback!('new ');
            messageCallback!('feature');
            messageCallback!('.');

            bodyCallback!('This commit ');
            bodyCallback!('adds a new ');
            bodyCallback!('feature.');

            // Complete both streams
            messageCompleteCallback!('Add new feature.');
            bodyCompleteCallback!('This commit adds a new feature.');

            // Wait for the promise to complete
            await streamPromise;

            // Verify prompt service was called correctly
            expect(promptService.generateCommitMessagePrompt).toHaveBeenCalledWith('en', 50, 'feat');
            expect(promptService.generateSummaryPrompt).toHaveBeenCalledWith('en');

            // Verify streaming callbacks were called
            expect(onMessageUpdate).toHaveBeenCalledTimes(4);
            expect(onMessageUpdate).toHaveBeenNthCalledWith(1, 'Add ');
            expect(onMessageUpdate).toHaveBeenNthCalledWith(2, 'new ');
            expect(onMessageUpdate).toHaveBeenNthCalledWith(3, 'feature');
            expect(onMessageUpdate).toHaveBeenNthCalledWith(4, '.');

            expect(onBodyUpdate).toHaveBeenCalledTimes(3);
            expect(onBodyUpdate).toHaveBeenNthCalledWith(1, 'This commit ');
            expect(onBodyUpdate).toHaveBeenNthCalledWith(2, 'adds a new ');
            expect(onBodyUpdate).toHaveBeenNthCalledWith(3, 'feature.');

            // Verify final callback
            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(onComplete).toHaveBeenCalledWith('Add new feature', 'This commit adds a new feature.');
        });
    });

    describe('reviseStreamingCommitMessage', () => {
        it('should stream revised commit message with callbacks', async () => {
            const diff = 'some diff';
            const userPrompt = 'Make it more descriptive';
            const config = {
                locale: 'en',
                maxLength: 50,
                model: 'gpt-3.5-turbo',
                type: 'feat',
            };

            configService.getConfig.mockReturnValue(config);

            // Mock implementation to simulate streaming completion
            let messageCallback: ((content: string) => void) | undefined;
            let messageCompleteCallback: ((finalContent: string) => void) | undefined;
            let bodyCallback: ((content: string) => void) | undefined;
            let bodyCompleteCallback: ((finalContent: string) => void) | undefined;

            aiProvider.streamCompletion.mockImplementation((params) => {
                // Store callbacks based on presence of userPrompt in the input
                if (params.messages.some((m: { content: string }) => m.content.includes('User revision prompt'))) {
                    if (params.messages.some((m: { content: string }) => m.content === 'generateCommitMessagePrompt')) {
                        messageCallback = params.onMessageDelta;
                        messageCompleteCallback = params.onComplete;
                    } else {
                        bodyCallback = params.onMessageDelta;
                        bodyCompleteCallback = params.onComplete;
                    }
                }
                return Promise.resolve();
            });

            const onMessageUpdate = vi.fn();
            const onBodyUpdate = vi.fn();
            const onComplete = vi.fn();

            // Start streaming
            const streamPromise = service.reviseStreamingCommitMessage({
                diff,
                userPrompt,
                onMessageUpdate,
                onBodyUpdate,
                onComplete,
            });

            // Ensure callbacks are defined
            expect(messageCallback).toBeDefined();
            expect(messageCompleteCallback).toBeDefined();
            expect(bodyCallback).toBeDefined();
            expect(bodyCompleteCallback).toBeDefined();

            // Now safely use them
            // Simulate message streaming
            messageCallback!('Add ');
            messageCallback!('comprehensive ');
            messageCallback!('feature ');
            messageCallback!('with validation');

            bodyCallback!('This commit ');
            bodyCallback!('implements a ');
            bodyCallback!('comprehensive feature ');
            bodyCallback!('with input validation.');

            // Complete both streams
            messageCompleteCallback!('Add comprehensive feature with validation');
            bodyCompleteCallback!('This commit implements a comprehensive feature with input validation.');

            // Wait for the promise to complete
            await streamPromise;

            // Verify service was called correctly
            expect(promptService.generateCommitMessagePrompt).toHaveBeenCalledWith('en', 50, 'feat');
            expect(promptService.generateSummaryPrompt).toHaveBeenCalledWith('en');

            // Verify the user prompt was included in the provider call
            expect(aiProvider.streamCompletion).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: expect.arrayContaining([
                        expect.objectContaining({
                            content: expect.stringContaining('User revision prompt: Make it more descriptive'),
                        }),
                    ]),
                }),
            );

            // Verify streaming callbacks
            expect(onMessageUpdate).toHaveBeenCalledTimes(4);
            expect(onBodyUpdate).toHaveBeenCalledTimes(4);

            // Verify final callback
            expect(onComplete).toHaveBeenCalledTimes(1);
            expect(onComplete).toHaveBeenCalledWith(
                'Add comprehensive feature with validation',
                'This commit implements a comprehensive feature with input validation.',
            );
        });
    });
});
