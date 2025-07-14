import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AICommitMessageService } from './ai-commit-message.service';
import type { LanguageModelV1 } from 'ai';

// Mock the generateText function from ai library
vi.mock('ai', async () => {
    const actual = await vi.importActual('ai');
    return {
        ...actual,
        generateText: vi.fn(),
    };
});

import { generateText } from 'ai';
const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

describe('AICommitMessageService', () => {
    let service: AICommitMessageService;
    let mockAIModel: LanguageModelV1;
    let mockConfigService: {
        getConfig: ReturnType<typeof vi.fn>;
    };
    let mockPromptService: {
        getAgentCommitMessageSystemPrompt: ReturnType<typeof vi.fn>;
        getAgentCommitMessageUserPrompt: ReturnType<typeof vi.fn>;
        getAgentCommitMessageWithInstructionsSystemPrompt: ReturnType<typeof vi.fn>;
        getAgentCommitMessageWithInstructionsUserPrompt: ReturnType<typeof vi.fn>;
    };
    let mockGitService: {
        getRecentCommitHistory: ReturnType<typeof vi.fn>;
        getStagedFileContent: ReturnType<typeof vi.fn>;
        getStagedFileLines: ReturnType<typeof vi.fn>;
        getStagedFileDiff: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mockAIModel = {
            provider: 'test',
            modelId: 'test-model',
            specificationVersion: 'v1',
            defaultObjectGenerationMode: 'json',
            doGenerate: vi.fn(),
            doStream: vi.fn(),
        } as LanguageModelV1;

        mockConfigService = {
            getConfig: vi.fn().mockReturnValue({
                maxLength: 50,
                model: 'gpt-4',
            }),
        };
        mockPromptService = {
            getAgentCommitMessageSystemPrompt: vi.fn().mockReturnValue('system prompt'),
            getAgentCommitMessageUserPrompt: vi.fn().mockReturnValue('user prompt'),
            getAgentCommitMessageWithInstructionsSystemPrompt: vi
                .fn()
                .mockImplementation(
                    (userInstructions: string) => `system prompt with instructions: ${userInstructions}`,
                ),
            getAgentCommitMessageWithInstructionsUserPrompt: vi
                .fn()
                .mockImplementation(
                    (maxLength: number, userInstructions: string) =>
                        `user prompt with instructions: ${userInstructions} and max length: ${maxLength}`,
                ),
        };
        mockGitService = {
            getRecentCommitHistory: vi.fn().mockResolvedValue([]),
            getStagedFileContent: vi.fn().mockResolvedValue('file content'),
            getStagedFileLines: vi.fn().mockResolvedValue('file content'),
            getStagedFileDiff: vi.fn().mockResolvedValue('diff content'),
        };

        service = new AICommitMessageService(
            mockAIModel,
            mockConfigService as never,
            mockPromptService as never,
            mockGitService as never,
        );
    });

    describe('generateAgentCommitMessage', () => {
        it('should generate commit message using agent pattern', async () => {
            // Mock the generateText function behavior
            mockGenerateText.mockResolvedValue({
                text: '',
                finishReason: 'stop',
                usage: { promptTokens: 0, completionTokens: 0 },
                rawCall: { rawPrompt: [], rawSettings: {} },
                rawResponse: { headers: {} },
                warnings: [],
                steps: [
                    {
                        toolCalls: [{ toolName: 'listStagedFiles', args: {}, toolCallId: 'call1' }],
                        toolResults: [],
                        text: '',
                        finishReason: 'tool-calls',
                        usage: { promptTokens: 0, completionTokens: 0 },
                        isContinued: false,
                    },
                    {
                        toolCalls: [],
                        toolResults: [
                            {
                                toolName: 'listStagedFiles',
                                toolCallId: 'call1',
                                result: { files: ['file1.ts'] },
                            },
                        ],
                        text: '',
                        finishReason: 'tool-calls',
                        usage: { promptTokens: 0, completionTokens: 0 },
                        isContinued: false,
                    },
                    {
                        toolCalls: [
                            {
                                toolName: 'finishCommitMessage',
                                args: { commitMessage: 'Add new feature', commitBody: 'Added user authentication' },
                                toolCallId: 'call2',
                            },
                        ],
                        toolResults: [],
                        text: '',
                        finishReason: 'tool-calls',
                        usage: { promptTokens: 0, completionTokens: 0 },
                        isContinued: false,
                    },
                ],
            });

            let finalMessage = '';
            let finalBody = '';

            await service.generateAgentCommitMessage({
                stagedFiles: ['file1.ts', 'file2.ts'],
                onStepUpdate: () => {
                    // Step update handler
                },
                onComplete: (message, body) => {
                    finalMessage = message;
                    finalBody = body;
                },
            });

            expect(mockGenerateText).toHaveBeenCalledWith({
                model: mockAIModel,
                messages: expect.arrayContaining([
                    { role: 'system', content: expect.any(String) },
                    { role: 'user', content: expect.any(String) },
                ]),
                tools: expect.any(Object),
                maxSteps: 50,
                temperature: 0.2,
                onStepFinish: expect.any(Function),
            });

            expect(finalMessage).toBe('Add new feature');
            expect(finalBody).toBe('Added user authentication');
        });

        it('should handle missing finishCommitMessage tool call', async () => {
            // Mock the generateText function behavior with no finishCommitMessage
            mockGenerateText.mockResolvedValue({
                text: '',
                finishReason: 'stop',
                usage: { promptTokens: 0, completionTokens: 0 },
                rawCall: { rawPrompt: [], rawSettings: {} },
                rawResponse: { headers: {} },
                warnings: [],
                steps: [
                    {
                        toolCalls: [{ toolName: 'listStagedFiles', args: {}, toolCallId: 'call1' }],
                        toolResults: [],
                        text: '',
                        finishReason: 'tool-calls',
                        usage: { promptTokens: 0, completionTokens: 0 },
                        isContinued: false,
                    },
                ],
            });

            await expect(
                service.generateAgentCommitMessage({
                    stagedFiles: ['file1.ts'],
                    onStepUpdate: () => {},
                    onComplete: () => {},
                }),
            ).rejects.toThrow('No finishCommitMessage tool call found - generation failed');
        });
    });

    describe('generateAgentCommitMessageWithInstructions', () => {
        it('should generate commit message using agent pattern with user instructions', async () => {
            // Mock the generateText function behavior
            mockGenerateText.mockResolvedValue({
                text: '',
                finishReason: 'stop',
                usage: { promptTokens: 0, completionTokens: 0 },
                rawCall: { rawPrompt: [], rawSettings: {} },
                rawResponse: { headers: {} },
                warnings: [],
                steps: [
                    {
                        toolCalls: [{ toolName: 'listStagedFiles', args: {}, toolCallId: 'call1' }],
                        toolResults: [],
                        text: '',
                        finishReason: 'tool-calls',
                        usage: { promptTokens: 0, completionTokens: 0 },
                        isContinued: false,
                    },
                    {
                        toolCalls: [],
                        toolResults: [
                            {
                                toolName: 'listStagedFiles',
                                toolCallId: 'call1',
                                result: { files: ['file1.ts'] },
                            },
                        ],
                        text: '',
                        finishReason: 'tool-calls',
                        usage: { promptTokens: 0, completionTokens: 0 },
                        isContinued: false,
                    },
                    {
                        toolCalls: [
                            {
                                toolName: 'finishCommitMessage',
                                args: {
                                    commitMessage: 'feat: Add authentication system',
                                    commitBody: 'Implemented user authentication with conventional commits format',
                                },
                                toolCallId: 'call2',
                            },
                        ],
                        toolResults: [],
                        text: '',
                        finishReason: 'tool-calls',
                        usage: { promptTokens: 0, completionTokens: 0 },
                        isContinued: false,
                    },
                ],
            });

            let finalMessage = '';
            let finalBody = '';

            await service.generateAgentCommitMessageWithInstructions({
                stagedFiles: ['file1.ts', 'file2.ts'],
                userInstructions: 'Use conventional commits format and be more descriptive',
                onStepUpdate: () => {
                    // Step update handler
                },
                onComplete: (message, body) => {
                    finalMessage = message;
                    finalBody = body;
                },
            });

            expect(mockGenerateText).toHaveBeenCalledWith({
                model: mockAIModel,
                messages: expect.arrayContaining([
                    {
                        role: 'system',
                        content: expect.stringContaining('Use conventional commits format and be more descriptive'),
                    },
                    {
                        role: 'user',
                        content: expect.stringContaining('Use conventional commits format and be more descriptive'),
                    },
                ]),
                tools: expect.any(Object),
                maxSteps: 50,
                temperature: 0.2,
                onStepFinish: expect.any(Function),
            });

            expect(finalMessage).toBe('feat: Add authentication system');
            expect(finalBody).toBe('Implemented user authentication with conventional commits format');
        });

        it('should handle missing finishCommitMessage tool call with instructions', async () => {
            // Mock the generateText function behavior with no finishCommitMessage
            mockGenerateText.mockResolvedValue({
                text: '',
                finishReason: 'stop',
                usage: { promptTokens: 0, completionTokens: 0 },
                rawCall: { rawPrompt: [], rawSettings: {} },
                rawResponse: { headers: {} },
                warnings: [],
                steps: [
                    {
                        toolCalls: [{ toolName: 'listStagedFiles', args: {}, toolCallId: 'call1' }],
                        toolResults: [],
                        text: '',
                        finishReason: 'tool-calls',
                        usage: { promptTokens: 0, completionTokens: 0 },
                        isContinued: false,
                    },
                ],
            });

            await expect(
                service.generateAgentCommitMessageWithInstructions({
                    stagedFiles: ['file1.ts'],
                    userInstructions: 'Make it more descriptive',
                    onStepUpdate: () => {},
                    onComplete: () => {},
                }),
            ).rejects.toThrow('No finishCommitMessage tool call found - generation failed');
        });
    });
});
