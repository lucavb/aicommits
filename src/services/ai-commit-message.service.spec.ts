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

const textStreamFrom = (parts: string[]) => ({
    textStream: {
        async *[Symbol.asyncIterator]() {
            for (const p of parts) {
                yield p;
            }
        },
    },
});

const throwingTextStream = (partsBeforeError: string[], error: Error) => ({
    textStream: {
        async *[Symbol.asyncIterator]() {
            for (const p of partsBeforeError) {
                yield p;
            }
            throw error;
        },
    },
});

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
        gitService.getRecentCommitMessages.mockResolvedValue(['abc123 initial commit']);

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

    it('should return subject and body from two streamed responses', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['feat:', ' add', ' feature']))
            .mockReturnValueOnce(textStreamFrom(['Added', ' feature', ' description']));

        const result = await service.generate({ diff: 'test diff' });

        expect(result).toEqual({ subject: 'feat: add feature', body: 'Added feature description' });
        expect(aiTextGenerationService.streamText).toHaveBeenCalledTimes(2);

        const subjectCall = aiTextGenerationService.streamText.mock.calls[0][0];
        expect(subjectCall.instructions).toBe(
            'You are a git commit message generator. Your task is to write clear, concise, and descriptive commit messages that follow best practices. Always use the imperative mood and focus on the intent and impact of the change. Do not include file names, code snippets, or unnecessary details. Never include explanations, commentary, or formatting outside the commit message itself.',
        );
        expect(subjectCall.messages).toEqual([
            { role: 'user', content: 'generateCommitMessagePrompt' },
            { role: 'user', content: 'test diff' },
        ]);
        expect(subjectCall.messages).not.toEqual(expect.arrayContaining([expect.objectContaining({ role: 'system' })]));

        const bodyCall = aiTextGenerationService.streamText.mock.calls[1][0];
        expect(bodyCall.instructions).toBe('generateSummaryPrompt');
        expect(bodyCall.messages).toEqual([{ role: 'user', content: 'test diff' }]);
    });

    it('should pass reasoning effort to both calls when configured', async () => {
        configService.getConfig.mockReturnValue({
            locale: 'en',
            maxLength: 50,
            type: 'conventional',
            provider: 'openai',
            model: 'gpt-5',
            reasoningEffort: 'high',
        });

        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['feat: x']))
            .mockReturnValueOnce(textStreamFrom(['body']));

        await service.generate({ diff: 'test diff' });

        expect(aiTextGenerationService.streamText.mock.calls[0][0].reasoning).toBe('high');
        expect(aiTextGenerationService.streamText.mock.calls[1][0].reasoning).toBe('high');
    });

    it('should not set reasoning when reasoningEffort is absent', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['feat: x']))
            .mockReturnValueOnce(textStreamFrom(['body']));

        await service.generate({ diff: 'test diff' });

        expect('reasoning' in aiTextGenerationService.streamText.mock.calls[0][0]).toBe(false);
        expect('reasoning' in aiTextGenerationService.streamText.mock.calls[1][0]).toBe(false);
    });

    it('should append the revision prompt to the user content of both calls', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['fix: x']))
            .mockReturnValueOnce(textStreamFrom(['body']));

        await service.generate({ diff: 'test diff', revision: 'make it shorter' });

        for (const call of aiTextGenerationService.streamText.mock.calls) {
            const lastMessage = call[0].messages[call[0].messages.length - 1];
            expect(lastMessage).toEqual({
                role: 'user',
                content: 'test diff\n\nUser revision prompt: make it shorter',
            });
        }
    });

    it('should sanitize the subject and trim the body', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['feat: add feature.\n\r']))
            .mockReturnValueOnce(textStreamFrom(['  Body text  \n']));

        const result = await service.generate({ diff: 'test diff' });

        expect(result.subject).toBe('feat: add feature');
        expect(result.body).toBe('Body text');
    });

    it('should return empty strings for empty streams', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom([]))
            .mockReturnValueOnce(textStreamFrom([]));

        const result = await service.generate({ diff: 'test diff' });

        expect(result).toEqual({ subject: '', body: '' });
    });

    it('should emit onDelta events for non-empty parts of both streams and filter whitespace-only parts', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['feat:', ' ', ' add feature']))
            .mockReturnValueOnce(textStreamFrom(['Body', '  \n', ' text']));

        const onDelta = vi.fn();
        const result = await service.generate({ diff: 'test diff', onDelta });

        expect(result).toEqual({ subject: 'feat:  add feature', body: 'Body  \n text' });

        const subjectDeltas = onDelta.mock.calls.filter((call) => call[0].stream === 'subject');
        const bodyDeltas = onDelta.mock.calls.filter((call) => call[0].stream === 'body');

        expect(subjectDeltas.map((call) => call[0])).toEqual([
            { part: 'feat:', stream: 'subject' },
            { part: ' add feature', stream: 'subject' },
        ]);
        expect(bodyDeltas.map((call) => call[0])).toEqual([
            { part: 'Body', stream: 'body' },
            { part: ' text', stream: 'body' },
        ]);
    });

    it('should reject when a stream throws mid-iteration instead of hanging', async () => {
        const streamError = new Error('stream exploded');
        aiTextGenerationService.streamText
            .mockReturnValueOnce(throwingTextStream(['feat:'], streamError))
            .mockReturnValueOnce(textStreamFrom(['body']));

        await expect(service.generate({ diff: 'test diff' })).rejects.toThrow('stream exploded');
    });

    it('should work with onDelta omitted', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['feat: add feature']))
            .mockReturnValueOnce(textStreamFrom(['Body text']));

        const result = await service.generate({ diff: 'test diff' });

        expect(result).toEqual({ subject: 'feat: add feature', body: 'Body text' });
    });
});
