import 'reflect-metadata';
import { Container } from 'inversify';
import { AICommitMessageService } from './ai-commit-message.service';

import { PromptService } from './prompt.service';
import { ConfigService } from './config.service';
import { Injectable } from '../utils/inversify';
import { AIProviderFactory } from './ai-provider.factory';
import { GitService } from './git.service';
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

@Injectable()
class MockGitService implements Partial<GitService> {
    getRecentCommitMessages = vi.fn();
}

describe('AICommitMessageService', () => {
    let configService: MockConfigService;
    let promptService: MockPromptService;
    let gitService: MockGitService;
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
        container.bind(GitService).to(MockGitService as unknown as typeof GitService);
        container.bind(AIProviderFactory).toDynamicValue(() => aiProviderFactory as unknown as AIProviderFactory);
        container.bind(AICommitMessageService).toSelf();

        configService = container.get<MockConfigService>(ConfigService as unknown as typeof MockConfigService);
        promptService = container.get<MockPromptService>(PromptService as unknown as typeof PromptService);
        gitService = container.get<MockGitService>(GitService as unknown as typeof MockGitService);
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
        gitService.getRecentCommitMessages.mockResolvedValue(['commit 1', 'commit 2']);

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
        expect(gitService.getRecentCommitMessages).toHaveBeenCalledWith(5);
        expect(promptService.generateCommitMessagePrompt).toHaveBeenCalledWith('en', 50, 'feat', [
            'commit 1',
            'commit 2',
        ]);
        expect(promptService.generateSummaryPrompt).toHaveBeenCalledWith('en');
    });

    it('should use recent commits when 5 or more are available', async () => {
        const diff = 'some diff';
        const config = {
            locale: 'en',
            maxLength: 50,
            model: 'gpt-3.5-turbo',
            type: 'conventional',
        };

        const recentCommits = [
            'feat: add new feature',
            'fix: resolve bug in component',
            'docs: update README',
            'refactor: improve code structure',
            'test: add unit tests',
        ];

        configService.getConfig.mockReturnValue(config);
        gitService.getRecentCommitMessages.mockResolvedValue(recentCommits);

        aiProvider.generateCompletion
            .mockResolvedValueOnce({
                choices: [{ message: { content: 'feat: implement new functionality' } }],
            })
            .mockResolvedValueOnce({
                choices: [{ message: { content: 'Summary of changes' } }],
            });

        const result = await service.generateCommitMessage({ diff });

        expect(result).toEqual({
            commitMessages: ['feat: implement new functionality'],
            bodies: ['Summary of changes'],
        });

        expect(gitService.getRecentCommitMessages).toHaveBeenCalledWith(5);
        expect(promptService.generateCommitMessagePrompt).toHaveBeenCalledWith('en', 50, 'conventional', recentCommits);
    });

    it('should fallback to type-based format when fewer than 5 recent commits', async () => {
        const diff = 'some diff';
        const config = {
            locale: 'en',
            maxLength: 50,
            model: 'gpt-3.5-turbo',
            type: 'conventional',
        };

        const recentCommits = ['feat: add feature', 'fix: bug fix'];

        configService.getConfig.mockReturnValue(config);
        gitService.getRecentCommitMessages.mockResolvedValue(recentCommits);

        aiProvider.generateCompletion
            .mockResolvedValueOnce({
                choices: [{ message: { content: 'feat: new feature' } }],
            })
            .mockResolvedValueOnce({
                choices: [{ message: { content: 'Summary' } }],
            });

        await service.generateCommitMessage({ diff });

        expect(gitService.getRecentCommitMessages).toHaveBeenCalledWith(5);
        expect(promptService.generateCommitMessagePrompt).toHaveBeenCalledWith('en', 50, 'conventional', recentCommits);
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
            gitService.getRecentCommitMessages.mockResolvedValue(['commit 1', 'commit 2']);

            const onMessageUpdate = vi.fn();
            const onBodyUpdate = vi.fn();
            const onComplete = vi.fn();

            // Mock streaming completion to immediately call callbacks
            aiProvider.streamCompletion.mockImplementation((params) => {
                // Simulate streaming by immediately calling the callbacks
                setTimeout(() => {
                    params.onMessageDelta?.('Streaming content');
                    params.onComplete?.('Final content');
                }, 0);
                return Promise.resolve();
            });

            // Start streaming
            await service.generateStreamingCommitMessage({
                diff,
                onMessageUpdate,
                onBodyUpdate,
                onComplete,
            });

            // Verify that streaming was called correctly
            expect(aiProvider.streamCompletion).toHaveBeenCalledTimes(2); // Once for message, once for body
            expect(gitService.getRecentCommitMessages).toHaveBeenCalledWith(5);
            expect(promptService.generateCommitMessagePrompt).toHaveBeenCalledWith('en', 50, 'feat', [
                'commit 1',
                'commit 2',
            ]);
            expect(promptService.generateSummaryPrompt).toHaveBeenCalledWith('en');
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
            gitService.getRecentCommitMessages.mockResolvedValue(['commit 1', 'commit 2']);

            const onMessageUpdate = vi.fn();
            const onBodyUpdate = vi.fn();
            const onComplete = vi.fn();

            // Mock streaming completion to immediately call callbacks
            aiProvider.streamCompletion.mockImplementation((params) => {
                // Simulate streaming by immediately calling the callbacks
                setTimeout(() => {
                    params.onMessageDelta?.('Streaming content');
                    params.onComplete?.('Final content');
                }, 0);
                return Promise.resolve();
            });

            // Start streaming
            await service.reviseStreamingCommitMessage({
                diff,
                userPrompt,
                onMessageUpdate,
                onBodyUpdate,
                onComplete,
            });

            // Verify that streaming was called correctly
            expect(aiProvider.streamCompletion).toHaveBeenCalledTimes(2); // Once for message, once for body
            expect(gitService.getRecentCommitMessages).toHaveBeenCalledWith(5);
            expect(promptService.generateCommitMessagePrompt).toHaveBeenCalledWith('en', 50, 'feat', [
                'commit 1',
                'commit 2',
            ]);
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

            // Verify streaming callbacks were called
            expect(onMessageUpdate).toHaveBeenCalled();
            expect(onBodyUpdate).toHaveBeenCalled();
            expect(onComplete).toHaveBeenCalled();
        });
    });
});
