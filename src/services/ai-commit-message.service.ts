import { Inject, Injectable } from '../utils/inversify';
import { ConfigService } from './config.service';
import { PromptService } from './prompt.service';
import { GitService } from './git.service';
import type { LanguageModelV1 } from 'ai';
import { generateText, tool } from 'ai';
import { z } from 'zod';

const sanitizeMessage = (message: string) =>
    message
        .replace(/[\n\r]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

type ReadStagedFileArgs = { filePath: string; startLine?: number; lineCount?: number };
type ReadStagedFileResult = { filePath: string; content: string } | { filePath: string; error: string };

type ReadStagedFileDiffsArgs = { filePaths: string[] };
type ReadStagedFileDiffsResult =
    | {
          fileDiffs: ({ filePath: string; diff: string } | { filePath: string; error: string })[];
      }
    | { error: string };

type ListStagedFilesArgs = Record<string, never>;
type ListStagedFilesResult = { files: string[]; totalFiles: number } | { error: string };

type GetRecentCommitMessageExamplesArgs = { count: number };
type GetRecentCommitMessageExamplesResult = { messages: string[] } | { error: string };

type FinishCommitMessageArgs = { commitMessage: string; commitBody?: string };
type FinishCommitMessageResult = {
    commitMessage: string;
    commitBody: string;
    success: boolean;
};

type StepUpdateEvent =
    | { type: 'tool-call'; toolName: 'readStagedFile'; args: ReadStagedFileArgs; toolCallId?: string }
    | { type: 'tool-call'; toolName: 'readStagedFileDiffs'; args: ReadStagedFileDiffsArgs; toolCallId?: string }
    | { type: 'tool-call'; toolName: 'listStagedFiles'; args: ListStagedFilesArgs; toolCallId?: string }
    | {
          type: 'tool-call';
          toolName: 'getRecentCommitMessageExamples';
          args: GetRecentCommitMessageExamplesArgs;
          toolCallId?: string;
      }
    | { type: 'tool-call'; toolName: 'finishCommitMessage'; args: FinishCommitMessageArgs; toolCallId?: string }
    | { type: 'tool-result'; toolName: 'readStagedFile'; result: ReadStagedFileResult; toolCallId?: string }
    | { type: 'tool-result'; toolName: 'readStagedFileDiffs'; result: ReadStagedFileDiffsResult; toolCallId?: string }
    | { type: 'tool-result'; toolName: 'listStagedFiles'; result: ListStagedFilesResult; toolCallId?: string }
    | {
          type: 'tool-result';
          toolName: 'getRecentCommitMessageExamples';
          result: GetRecentCommitMessageExamplesResult;
          toolCallId?: string;
      }
    | { type: 'tool-result'; toolName: 'finishCommitMessage'; result: FinishCommitMessageResult; toolCallId?: string }
    | { type: 'finish' };

export const AI_MODEL_SYMBOL = Symbol.for('AIModel');

@Injectable()
export class AICommitMessageService {
    constructor(
        @Inject(AI_MODEL_SYMBOL) private readonly aiModel: LanguageModelV1,
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(PromptService) private readonly promptService: PromptService,
        @Inject(GitService) private readonly gitService: GitService,
    ) {}

    async generateAgentCommitMessage({
        stagedFiles,
        onStepUpdate,
        onComplete,
    }: {
        stagedFiles: string[];
        onStepUpdate: (stepInfo: StepUpdateEvent) => void;
        onComplete: (commitMessage: string, body: string) => void;
    }): Promise<void> {
        const { maxLength } = this.configService.getConfig();

        const tools = {
            readStagedFile: tool({
                description:
                    'Read the content of a specific staged file. You can specify which lines to read for better efficiency.',
                parameters: z
                    .object({
                        filePath: z.string().describe('The path of the staged file to read'),
                        startLine: z
                            .number()
                            .min(1)
                            .optional()
                            .describe('Starting line number (1-based). Defaults to 1 if not specified.'),
                        lineCount: z
                            .number()
                            .min(1)
                            .optional()
                            .describe(
                                'Number of lines to read from the start line. If not specified, reads to the end of the file.',
                            ),
                    })
                    .describe('Parameters for reading a staged file'),
                execute: async ({ filePath, startLine, lineCount }) => {
                    try {
                        const content = await this.gitService.getStagedFileLines(filePath, startLine, lineCount);
                        return {
                            filePath,
                            content,
                        };
                    } catch (error) {
                        return {
                            error: error instanceof Error ? error.message : 'Unknown error reading file',
                            filePath,
                        };
                    }
                },
            }),
            readStagedFileDiffs: tool({
                description:
                    'Read the diff/changed hunks of multiple staged files to understand what was modified - more efficient for analyzing changes',
                parameters: z
                    .object({ filePaths: z.array(z.string()).describe('Array of staged file paths to read diffs for') })
                    .describe('Parameters for reading staged file diffs'),
                execute: async ({ filePaths }) => {
                    try {
                        const fileDiffs = await Promise.all(
                            filePaths.map(async (filePath) => {
                                try {
                                    const diff = await this.gitService.getStagedFileDiff(filePath);
                                    return {
                                        filePath,
                                        diff: diff || 'No changes detected in this file',
                                    };
                                } catch (error) {
                                    return {
                                        filePath,
                                        error:
                                            error instanceof Error ? error.message : 'Unknown error reading file diff',
                                    };
                                }
                            }),
                        );
                        return { fileDiffs };
                    } catch (error) {
                        return {
                            error: error instanceof Error ? error.message : 'Unknown error reading file diffs',
                        };
                    }
                },
            }),
            listStagedFiles: tool({
                description: 'List all staged files to understand the scope of changes',
                parameters: z.object({}).describe('No parameters needed'),
                execute: async () => {
                    try {
                        return { files: stagedFiles, totalFiles: stagedFiles.length };
                    } catch (error) {
                        return { error: error instanceof Error ? error.message : 'Unknown error listing files' };
                    }
                },
            }),
            getRecentCommitMessageExamples: tool({
                description: 'Get examples of recent commit messages to understand the style and format',
                parameters: z
                    .object({
                        count: z.number().min(1).max(20).default(10).describe('Number of recent commits to fetch'),
                    })
                    .describe('Parameters for fetching recent commits'),
                execute: async ({ count }) => {
                    try {
                        const commits = await this.gitService.getRecentCommitHistory(count);
                        return {
                            messages: commits.map((commit) => commit.message),
                        };
                    } catch (error) {
                        return {
                            error: error instanceof Error ? error.message : 'Unknown error fetching recent commits',
                        };
                    }
                },
            }),
            finishCommitMessage: tool({
                description: 'Finish the commit message generation process with the final commit message and body',
                parameters: z
                    .object({
                        commitMessage: z
                            .string()
                            .describe('The final commit message (should be concise and descriptive)'),
                        commitBody: z.string().optional().describe('Optional commit body with additional details'),
                    })
                    .describe('The final commit message and optional body'),
                execute: ({ commitMessage, commitBody }) => {
                    return Promise.resolve({
                        commitMessage,
                        commitBody: commitBody || '',
                        success: true,
                    });
                },
            }),
        };

        const systemPrompt = this.promptService.getAgentCommitMessageSystemPrompt();
        const userPrompt = this.promptService.getAgentCommitMessageUserPrompt(maxLength);

        let commitMessage = '';
        let commitBody = '';

        const result = await generateText({
            model: this.aiModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            tools,
            maxSteps: 50,
            temperature: 0.2,
            onStepFinish({ toolResults }) {
                for (const toolResult of toolResults) {
                    if (toolResult.toolName === 'readStagedFile') {
                        onStepUpdate({
                            type: 'tool-result',
                            toolName: 'readStagedFile',
                            result: toolResult.result as ReadStagedFileResult,
                            toolCallId: toolResult.toolCallId,
                        });
                    } else if (toolResult.toolName === 'readStagedFileDiffs') {
                        onStepUpdate({
                            type: 'tool-result',
                            toolName: 'readStagedFileDiffs',
                            result: toolResult.result as ReadStagedFileDiffsResult,
                            toolCallId: toolResult.toolCallId,
                        });
                    } else if (toolResult.toolName === 'listStagedFiles') {
                        onStepUpdate({
                            type: 'tool-result',
                            toolName: 'listStagedFiles',
                            result: toolResult.result as ListStagedFilesResult,
                            toolCallId: toolResult.toolCallId,
                        });
                    } else if (toolResult.toolName === 'getRecentCommitMessageExamples') {
                        onStepUpdate({
                            type: 'tool-result',
                            toolName: 'getRecentCommitMessageExamples',
                            result: toolResult.result as GetRecentCommitMessageExamplesResult,
                            toolCallId: toolResult.toolCallId,
                        });
                    } else if (toolResult.toolName === 'finishCommitMessage') {
                        onStepUpdate({
                            type: 'tool-result',
                            toolName: 'finishCommitMessage',
                            result: toolResult.result as FinishCommitMessageResult,
                            toolCallId: toolResult.toolCallId,
                        });
                    }
                }
            },
        });

        onStepUpdate({ type: 'finish' });

        // Extract commit message and body from the finishCommitMessage tool call
        // Look through ALL steps to find the finishCommitMessage call
        let finishToolCall = null;
        for (const step of result.steps) {
            const foundFinishCall = step.toolCalls?.find((tc) => tc.toolName === 'finishCommitMessage');
            if (foundFinishCall) {
                finishToolCall = foundFinishCall;
                break;
            }
        }

        if (finishToolCall) {
            const args = finishToolCall.args as { commitMessage: string; commitBody?: string };
            commitMessage = sanitizeMessage(args.commitMessage);
            commitBody = args.commitBody || '';
        } else {
            // Fallback: Try to extract commit message from final text if it looks like a commit message
            if (result.text && result.text.trim().length > 0) {
                const finalText = result.text.trim();

                // Check if the final text looks like a commit message (not JSON)
                if (!finalText.startsWith('{') && !finalText.startsWith('[')) {
                    console.warn('Warning: Using fallback commit message extraction from final text');
                    commitMessage = sanitizeMessage(finalText);
                    commitBody = '';
                } else {
                    // If it's JSON, try to parse it as a tool call attempt
                    try {
                        const possibleToolCall = JSON.parse(finalText);
                        if (
                            possibleToolCall.type === 'function' &&
                            possibleToolCall.name === 'getRecentCommitMessageExamples'
                        ) {
                            throw new Error(
                                'AI model attempted to call getRecentCommitMessageExamples but failed to complete the workflow. The model may have hit a context limit or encountered an error. Please try again with fewer files or a different model.',
                            );
                        }
                    } catch {
                        // If we can't parse the JSON, fall through to the original error
                    }

                    console.error('Debug: No finishCommitMessage tool call found');
                    console.error('Debug: Result steps:', result.steps.length);
                    console.error('Debug: Tool calls in each step:');
                    result.steps.forEach((step, i) => {
                        console.error(`Step ${i}:`, step.toolCalls?.map((tc) => tc.toolName) || 'no tool calls');
                    });
                    console.error('Debug: Final text:', result.text);

                    throw new Error('No finishCommitMessage tool call found - generation failed');
                }
            } else {
                console.error('Debug: No finishCommitMessage tool call found');
                console.error('Debug: Result steps:', result.steps.length);
                console.error('Debug: Tool calls in each step:');
                result.steps.forEach((step, i) => {
                    console.error(`Step ${i}:`, step.toolCalls?.map((tc) => tc.toolName) || 'no tool calls');
                });
                console.error('Debug: Final text:', result.text);

                throw new Error('No finishCommitMessage tool call found - generation failed');
            }
        }

        onComplete(commitMessage, commitBody);
    }
}
