import 'reflect-metadata';
import { Container } from 'inversify';
import { AICommitMessageService } from './ai-commit-message.service';
import { PromptService } from './prompt.service';
import { Injectable } from '../utils/inversify';
import { AIProviderFactory } from './ai-provider.factory';
import { AITextGenerationService } from './ai-text-generation.service';
import { GitService } from './git.service';
import { READY_PROFILE } from '../profile/resolved-profile';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class ProfileSettingsStub {
    get = vi.fn();
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
    let profileSettings: ProfileSettingsStub;
    let gitService: MockGitService;
    let mockModel: unknown;
    let promptService: MockPromptService;
    let service: AICommitMessageService;

    beforeEach(() => {
        vi.clearAllMocks();

        aiProviderFactory = new MockAIProviderFactory();
        aiTextGenerationService = new MockAITextGenerationService();
        profileSettings = new ProfileSettingsStub();
        gitService = new MockGitService();
        promptService = new MockPromptService();
        mockModel = {}; // Mock LanguageModel

        aiProviderFactory.createModel.mockReturnValue(mockModel);
        gitService.getRecentCommitMessages.mockResolvedValue(['abc123 initial commit']);

        profileSettings.get.mockReturnValue({
            locale: 'en',
            maxLength: 50,
            type: 'conventional',
        });

        const container = new Container();
        container.bind(AICommitMessageService).toSelf();
        container.bind(AIProviderFactory).toConstantValue(aiProviderFactory as unknown as AIProviderFactory);
        container.bind(AITextGenerationService).toConstantValue(aiTextGenerationService);
        container.bind(READY_PROFILE).toConstantValue(() => ({ status: 'ready', settings: profileSettings.get() }));
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
        profileSettings.get.mockReturnValue({
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

    it('should strip SGR conceal and other ANSI sequences from subject and body', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['Fix\x1b[2J\x1b[1;30H login', ' race on token refresh']))
            .mockReturnValueOnce(
                textStreamFrom(['AI summary. \x1b[8mSigned-off-by: model-bot <bot@example.com>\x1b[28m']),
            );

        const result = await service.generate({ diff: 'test diff' });

        // displayed text must equal committed bytes - no concealing SGR pair survives
        expect(result.subject).toBe('Fix login race on token refresh');
        expect(result.body).toBe('AI summary. Signed-off-by: model-bot <bot@example.com>');
        // eslint-disable-next-line no-control-regex -- fixture assertion: ESC bytes must be gone
        expect(result.body).not.toMatch(/\x1b/);
    });

    it('should strip OSC-8 hyperlink and BEL-terminated OSC sequences from subject and body', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['\x1b]0;title-spoof\x07feat: add feature']))
            .mockReturnValueOnce(textStreamFrom(['\x1b]8;;http://127.0.0.1/x\x1b\\click\x1b]8;;\x1b\\ me']));

        const result = await service.generate({ diff: 'test diff' });

        expect(result.subject).toBe('feat: add feature');
        expect(result.body).toBe('click me');
    });

    it('should remove C1 control bytes so no escape sequence can be reconstructed', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['feat: add feature']))
            .mockReturnValueOnce(textStreamFrom(['hidden\u009b8m\u009b28m tail\u009b?25l']));

        const result = await service.generate({ diff: 'test diff' });

        expect(result.subject).toBe('feat: add feature');
        expect(result.body).toBe('hidden8m28m tail?25l');
        // eslint-disable-next-line no-control-regex -- fixture assertion: C0/C1 bytes must be gone
        expect(result.body).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    });

    it('should pass an explicit onError to both streamText calls', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['feat: x']))
            .mockReturnValueOnce(textStreamFrom(['body']));

        await service.generate({ diff: 'test diff' });

        expect(typeof aiTextGenerationService.streamText.mock.calls[0][0].onError).toBe('function');
        expect(typeof aiTextGenerationService.streamText.mock.calls[1][0].onError).toBe('function');
    });

    it('should render a redacted single-line summary for a stubbed provider error via the explicit onError', async () => {
        aiTextGenerationService.streamText
            .mockReturnValueOnce(textStreamFrom(['feat: x']))
            .mockReturnValueOnce(textStreamFrom(['body']));
        await service.generate({ diff: 'test diff' });

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const subjectOnError = aiTextGenerationService.streamText.mock.calls[0][0].onError as ({
            error,
        }: {
            error: unknown;
        }) => void;
        const bodyOnError = aiTextGenerationService.streamText.mock.calls[1][0].onError as ({
            error,
        }: {
            error: unknown;
        }) => void;

        subjectOnError({
            error: new Error('provider boom\nsecond line\x1b]8;;http://attacker.example\x07\x1b[2K wiped'),
        });
        bodyOnError({ error: new Error('remote\x9b8mconceal\u0007') });

        expect(errorSpy).toHaveBeenCalledTimes(2);
        const rendered = errorSpy.mock.calls.map((call) => String(call[0]));
        expect(rendered[0]).toBe('Commit-message subject generation failed: provider boom second line wiped');
        expect(rendered[1]).toBe('Commit-message body generation failed: remote8mconceal');
        for (const line of rendered) {
            expect(line).not.toMatch(/\n/);
            // eslint-disable-next-line no-control-regex -- fixture assertion: C0/C1 bytes must be gone
            expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
        }
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

        // final body is control-neutralized at the sanitize boundary: the raw
        // \n of the stream part no longer reaches the returned value
        expect(result).toEqual({ subject: 'feat:  add feature', body: 'Body   text' });

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
