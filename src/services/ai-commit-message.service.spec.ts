import 'reflect-metadata';
import { Container } from 'inversify';
import { AICommitMessageService } from './ai-commit-message.service';
import { PromptService } from './prompt.service';
import { ConfigService } from './config.service';
import { Injectable } from '../utils/inversify';
import { AIProviderFactory } from './ai-provider.factory';
import { AITextGenerationService } from './ai-text-generation.service';
import { GitService } from './git.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
class MockAIProviderFactory implements Partial<AIProviderFactory> {
    createModel = vi.fn();
}

@Injectable()
class MockAITextGenerationService implements AITextGenerationService {
    generateText = vi.fn();
    streamText = vi.fn();
}

@Injectable()
class MockGitService implements Partial<GitService> {
    getRecentCommitMessages = vi.fn();
}

describe('AICommitMessageService', () => {
    let aiProviderFactory: MockAIProviderFactory;
    let aiTextGenerationService: MockAITextGenerationService;
    let configService: MockConfigService;
    let gitService: MockGitService;
    let mockModel: unknown;
    let promptService: MockPromptService;
    let service: AICommitMessageService;

    beforeEach(() => {
        vi.clearAllMocks();

        aiProviderFactory = new MockAIProviderFactory();
        aiTextGenerationService = new MockAITextGenerationService();
        configService = new MockConfigService();
        gitService = new MockGitService();
        promptService = new MockPromptService();
        mockModel = {}; // Mock LanguageModel

        aiProviderFactory.createModel.mockReturnValue(mockModel);

        configService.getConfig.mockReturnValue({
            locale: 'en',
            maxLength: 50,
            type: 'conventional',
        });

        const container = new Container();
        container.bind(AICommitMessageService).toSelf();
        container.bind(AIProviderFactory).toConstantValue(aiProviderFactory as unknown as AIProviderFactory);
        container.bind(AITextGenerationService).toConstantValue(aiTextGenerationService);
        container.bind(ConfigService).toConstantValue(configService as unknown as ConfigService);
        container.bind(GitService).toConstantValue(gitService as unknown as GitService);
        container.bind(PromptService).toConstantValue(promptService as PromptService);

        service = container.get(AICommitMessageService);
    });

    describe('generateCommitMessage', () => {
        it('should generate commit messages and bodies', async () => {
            const mockCommitText = 'feat: add new feature';
            const mockBodyText = 'Added feature description';

            aiTextGenerationService.generateText
                .mockResolvedValueOnce({ text: mockCommitText })
                .mockResolvedValueOnce({ text: mockBodyText });

            const result = await service.generateCommitMessage({
                diff: 'test diff',
            });

            expect(aiTextGenerationService.generateText).toHaveBeenCalledTimes(2);
            expect(result).toEqual({
                commitMessages: [mockCommitText],
                bodies: [mockBodyText],
            });
        });

        it('should handle empty responses', async () => {
            aiTextGenerationService.generateText
                .mockResolvedValueOnce({ text: '' })
                .mockResolvedValueOnce({ text: '' });

            const result = await service.generateCommitMessage({
                diff: 'test diff',
            });

            expect(result).toEqual({
                commitMessages: [''],
                bodies: [''],
            });
        });

        it('should sanitize commit messages', async () => {
            const mockCommitText = 'feat: add new feature.\n\r';
            const mockBodyText = 'Added feature description';

            aiTextGenerationService.generateText
                .mockResolvedValueOnce({ text: mockCommitText })
                .mockResolvedValueOnce({ text: mockBodyText });

            const result = await service.generateCommitMessage({
                diff: 'test diff',
            });

            expect(result.commitMessages).toEqual(['feat: add new feature']);
        });
    });

    describe('generateStreamingCommitMessage', () => {
        it('should stream commit messages and bodies', async () => {
            const commitParts = ['feat:', ' add', ' feature'];
            const bodyParts = ['Added', ' feature', ' description'];

            const mockCommitStream = {
                async *[Symbol.asyncIterator]() {
                    for (const part of commitParts) {
                        yield part;
                    }
                },
            };

            const mockBodyStream = {
                async *[Symbol.asyncIterator]() {
                    for (const part of bodyParts) {
                        yield part;
                    }
                },
            };

            aiTextGenerationService.streamText
                .mockReturnValueOnce({ textStream: mockCommitStream })
                .mockReturnValueOnce({ textStream: mockBodyStream });

            const onMessageUpdate = vi.fn();
            const onBodyUpdate = vi.fn();
            const onComplete = vi.fn();

            await service.generateStreamingCommitMessage({
                diff: 'test diff',
                onMessageUpdate,
                onBodyUpdate,
                onComplete,
            });

            expect(onMessageUpdate).toHaveBeenCalledTimes(3);
            expect(onBodyUpdate).toHaveBeenCalledTimes(3);
            expect(onComplete).toHaveBeenCalledWith('feat: add feature', 'Added feature description');
        });
    });

    describe('reviseCommitMessage', () => {
        it('should revise commit messages with user prompt', async () => {
            const mockCommitText = 'fix: resolve issue';
            const mockBodyText = 'Fixed the issue as requested';

            aiTextGenerationService.generateText
                .mockResolvedValueOnce({ text: mockCommitText })
                .mockResolvedValueOnce({ text: mockBodyText });

            const result = await service.reviseCommitMessage({
                diff: 'test diff',
                userPrompt: 'make it shorter',
            });

            expect(aiTextGenerationService.generateText).toHaveBeenCalledTimes(2);
            expect(result).toEqual({
                commitMessages: [mockCommitText],
                bodies: [mockBodyText],
            });
        });
    });

    describe('reviseStreamingCommitMessage', () => {
        it('should stream revised commit messages', async () => {
            const commitParts = ['fix:', ' resolve', ' issue'];
            const bodyParts = ['Fixed', ' the', ' issue'];

            const mockCommitStream = {
                async *[Symbol.asyncIterator]() {
                    for (const part of commitParts) {
                        yield part;
                    }
                },
            };

            const mockBodyStream = {
                async *[Symbol.asyncIterator]() {
                    for (const part of bodyParts) {
                        yield part;
                    }
                },
            };

            aiTextGenerationService.streamText
                .mockReturnValueOnce({ textStream: mockCommitStream })
                .mockReturnValueOnce({ textStream: mockBodyStream });

            const onMessageUpdate = vi.fn();
            const onBodyUpdate = vi.fn();
            const onComplete = vi.fn();

            await service.reviseStreamingCommitMessage({
                diff: 'test diff',
                onBodyUpdate,
                onComplete,
                onMessageUpdate,
                userPrompt: 'make it shorter',
            });

            expect(onMessageUpdate).toHaveBeenCalledTimes(3);
            expect(onBodyUpdate).toHaveBeenCalledTimes(3);
            expect(onComplete).toHaveBeenCalledWith('fix: resolve issue', 'Fixed the issue');
        });
    });
});
