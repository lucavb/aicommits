import { z } from 'zod';
import { Inject, Injectable } from '../utils/inversify';
import { GitService } from './git.service';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';

import { tool } from 'ai';
import { Change } from 'parse-diff';

@Injectable()
export class GitToolsService {
    constructor(@Inject(GitService) private readonly gitService: GitService) {}

    createTools(onToolCall: (msg: string) => void | Promise<void>) {
        return {
            getDiff: tool({
                description:
                    'Get git diff to see changes in the repository. Use "staged" to see staged changes or "working" to see unstaged changes.',
                inputSchema: z.object({
                    type: z
                        .enum(['staged', 'working'])
                        .describe('Type of diff to get - staged shows staged changes, working shows unstaged changes'),
                    contextLines: z.number().optional().describe('Number of context lines to include in diff'),
                }),
                execute: async ({ type, contextLines }) => {
                    onToolCall('Analyzing git diff to understand changes');

                    const contextLinesValue = contextLines ?? 3;
                    try {
                        if (type === 'staged') {
                            const staged = await this.gitService.getStagedDiff([], contextLinesValue);
                            if (!staged) {
                                return {
                                    success: true,
                                    type: 'staged',
                                    hasChanges: false,
                                    files: [],
                                    diff: '',
                                    contextLines: contextLinesValue,
                                };
                            }
                            return {
                                success: true,
                                type: 'staged',
                                hasChanges: true,
                                files: staged.files,
                                diff: staged.diff,
                                contextLines: contextLinesValue,
                            };
                        } else {
                            const diff = await this.gitService.getWorkingDiff(contextLinesValue);
                            if (!diff) {
                                return {
                                    success: true,
                                    type: 'working',
                                    hasChanges: false,
                                    files: [],
                                    diff: '',
                                    contextLines: contextLinesValue,
                                };
                            }
                            return {
                                success: true,
                                type: 'working',
                                hasChanges: true,
                                files: [],
                                diff,
                                contextLines: contextLinesValue,
                            };
                        }
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error getting diff: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            type,
                        };
                    }
                },
            }),

            listFiles: tool({
                description: 'List files in the repository or a specific directory.',
                inputSchema: z.object({
                    directory: z.string().optional().describe('Directory to list files from (relative to git root)'),
                    includeHidden: z.boolean().optional().describe('Include hidden files starting with dot'),
                }),
                execute: async ({ directory, includeHidden }) => {
                    onToolCall('Exploring repository files and structure');

                    const directoryValue = directory ?? '.';
                    const includeHiddenValue = includeHidden ?? false;
                    try {
                        const gitRoot = await this.gitService.assertGitRepo();
                        const fullPath = join(gitRoot, directoryValue);

                        const items = await readdir(fullPath);
                        const files: { name: string; type: 'file' | 'directory' }[] = [];

                        for (const item of items) {
                            if (!includeHiddenValue && item.startsWith('.')) {
                                continue;
                            }

                            const itemPath = join(fullPath, item);
                            const stats = await stat(itemPath);
                            const type = stats.isDirectory() ? 'directory' : 'file';
                            files.push({ name: item, type });
                        }

                        return {
                            success: true,
                            directory: directoryValue,
                            includeHidden: includeHiddenValue,
                            files,
                            count: files.length,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            directory: directoryValue,
                        };
                    }
                },
            }),
            getStagedFiles: tool({
                description: 'Get list of files that are currently staged for commit.',
                inputSchema: z.object({}),
                execute: async () => {
                    onToolCall('Checking which files are staged for commit');

                    try {
                        const staged = await this.gitService.getStagedDiff([], 0);
                        if (!staged) {
                            return {
                                success: true,
                                hasStaged: false,
                                files: [],
                                count: 0,
                            };
                        }
                        return {
                            success: true,
                            hasStaged: true,
                            files: staged.files,
                            count: staged.files.length,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error getting staged files: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        };
                    }
                },
            }),

            stageFiles: tool({
                description: 'Stage specific files for commit.',
                inputSchema: z.object({
                    files: z.array(z.string()).describe('Array of file paths to stage'),
                }),
                execute: async ({ files }) => {
                    onToolCall('Staging files for commit');

                    try {
                        await this.gitService.stageFiles(files);
                        return {
                            success: true,
                            operation: 'stage',
                            files,
                            count: files.length,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error staging files: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            operation: 'stage',
                            files,
                        };
                    }
                },
            }),

            unstageFiles: tool({
                description: 'Unstage specific files.',
                inputSchema: z.object({
                    files: z.array(z.string()).describe('Array of file paths to unstage'),
                }),
                execute: async ({ files }) => {
                    onToolCall('Unstaging files');

                    try {
                        await this.gitService.unstageFiles(files);
                        return {
                            success: true,
                            operation: 'unstage',
                            files,
                            count: files.length,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error unstaging files: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            operation: 'unstage',
                            files,
                        };
                    }
                },
            }),

            getFileContent: tool({
                description: 'Get the content of a specific file starting from a specific line.',
                inputSchema: z.object({
                    filePath: z.string().describe('Path to the file to read (relative to git root)'),
                    startLine: z.number().optional().describe('Starting line number (1-based, default: 1)'),
                    lineCount: z
                        .number()
                        .optional()
                        .describe('Number of lines to read from starting line (default: 100, max: 300)'),
                }),
                execute: async ({ filePath, startLine, lineCount }) => {
                    const startLineValue = startLine ?? 1;
                    const lineCountValue = Math.min(lineCount ?? 100, 300); // Cap at 300 lines

                    onToolCall(
                        `Reading file contents: ${filePath} (lines ${startLineValue}-${startLineValue + lineCountValue - 1})`,
                    );

                    try {
                        const gitRoot = await this.gitService.assertGitRepo();
                        const fullPath = join(gitRoot, filePath);

                        const content = await readFile(fullPath, 'utf-8');
                        const allLines = content.split('\n');
                        const totalLines = allLines.length;

                        // Convert to 0-based indexing and validate bounds
                        const startIndex = Math.max(0, startLineValue - 1);
                        const endIndex = Math.min(totalLines, startIndex + lineCountValue);

                        const selectedLines = allLines.slice(startIndex, endIndex);
                        const finalContent = selectedLines.join('\n');
                        const actualLinesReturned = selectedLines.length;

                        const isTruncated = endIndex < totalLines || startIndex > 0;
                        const actualEndLine = startIndex + actualLinesReturned;

                        return {
                            success: true,
                            filePath,
                            content: finalContent,
                            totalLines,
                            startLine: startLineValue,
                            endLine: actualEndLine,
                            requestedLines: lineCountValue,
                            returnedLines: actualLinesReturned,
                            isTruncated,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            filePath,
                        };
                    }
                },
            }),

            getCommitHistory: tool({
                description: 'Get recent commit history for context.',
                inputSchema: z.object({
                    count: z.number().optional().describe('Number of recent commits to retrieve'),
                }),
                execute: async ({ count }) => {
                    onToolCall('Reviewing recent commit history for patterns');

                    const countValue = count ?? 5;
                    try {
                        const historyString = await this.gitService.getCommitHistory(countValue);
                        const commits = historyString
                            .split('\n')
                            .filter(Boolean)
                            .map((line) => {
                                const match = line.match(/^([a-f0-9]+) - (.+) \((.+)\)$/);
                                if (match) {
                                    return {
                                        hash: match[1],
                                        message: match[2],
                                        author: match[3],
                                    };
                                }
                                return { hash: '', message: line, author: '' };
                            });

                        return {
                            success: true,
                            commits,
                            count: commits.length,
                            requestedCount: countValue,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error getting commit history: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            requestedCount: countValue,
                        };
                    }
                },
            }),

            getStatus: tool({
                description: 'Get current git status showing staged, unstaged, and untracked files.',
                inputSchema: z.object({}),
                execute: async () => {
                    onToolCall('Checking git repository status');

                    try {
                        const status = await this.gitService.getStatus();
                        if (status === 'Working tree clean') {
                            return {
                                success: true,
                                isClean: true,
                                staged: [],
                                modified: [],
                                untracked: [],
                                totalChanges: 0,
                            };
                        }

                        // Parse the status string to extract structured data
                        const lines = status.split('\n');
                        const staged: string[] = [];
                        const modified: string[] = [];
                        const untracked: string[] = [];

                        let currentSection = '';
                        for (const line of lines) {
                            if (line.startsWith('Staged files')) {
                                currentSection = 'staged';
                            } else if (line.startsWith('Modified files')) {
                                currentSection = 'modified';
                            } else if (line.startsWith('Untracked files')) {
                                currentSection = 'untracked';
                            } else if (line.startsWith('  ')) {
                                const fileName = line.trim();
                                if (currentSection === 'staged') {
                                    staged.push(fileName);
                                } else if (currentSection === 'modified') {
                                    modified.push(fileName);
                                } else if (currentSection === 'untracked') {
                                    untracked.push(fileName);
                                }
                            }
                        }

                        return {
                            success: true,
                            isClean: false,
                            staged,
                            modified,
                            untracked,
                            totalChanges: staged.length + modified.length + untracked.length,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error getting git status: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        };
                    }
                },
            }),

            getWorkingChangesAsHunks: tool({
                description: 'Get working directory changes as structured hunks using parse-diff library.',
                inputSchema: z.object({}),
                execute: async () => {
                    onToolCall('Analyzing working directory changes and extracting hunks with parse-diff');

                    try {
                        const hunks = await this.gitService.getWorkingChangesAsHunks();
                        if (hunks.length === 0) {
                            return {
                                success: true,
                                hasChanges: false,
                                hunks: [],
                                totalHunks: 0,
                                affectedFiles: [],
                                totalFiles: 0,
                            };
                        }

                        const affectedFiles = [...new Set(hunks.map((h) => h.file))];

                        return {
                            success: true,
                            hasChanges: true,
                            hunks: hunks.map((hunk) => ({
                                hunkId: hunk.hunkId,
                                file: hunk.file,
                                summary: hunk.summary,
                                oldStart: hunk.oldStart,
                                newStart: hunk.newStart,
                                oldLines: hunk.chunk.oldLines,
                                newLines: hunk.chunk.newLines,
                                linesAdded: hunk.linesAdded,
                                linesRemoved: hunk.linesRemoved,
                                changes: hunk.chunk.changes.map((c) => ({
                                    type: c.type,
                                    content: c.content,
                                    lineNumber: GitToolsService.getLineNumberFromChange(c),
                                })),
                            })),
                            totalHunks: hunks.length,
                            affectedFiles,
                            totalFiles: affectedFiles.length,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error getting working changes as hunks: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        };
                    }
                },
            }),

            stageSelectedHunks: tool({
                description:
                    'Stage specific hunks by their IDs using git native patch application for precise commit control.',
                inputSchema: z.object({
                    hunkIds: z.array(z.string()).describe('Array of hunk IDs from getWorkingChangesAsHunks to stage'),
                }),
                execute: async ({ hunkIds }) => {
                    onToolCall('Staging selected hunks by ID using git patch application');

                    try {
                        // First get all available hunks
                        const allHunks = await this.gitService.getWorkingChangesAsHunks();

                        // Filter to only the requested hunks
                        const selectedHunks = allHunks.filter((hunk) => hunkIds.includes(hunk.hunkId));
                        const missingIds = hunkIds.filter((id) => !selectedHunks.some((h) => h.hunkId === id));
                        const affectedFiles = [...new Set(selectedHunks.map((h) => h.file))];

                        if (selectedHunks.length === 0) {
                            return {
                                success: false,
                                error: 'No matching hunks found for the provided IDs',
                                requestedIds: hunkIds,
                                foundIds: [],
                                missingIds: hunkIds,
                            };
                        }

                        // Stage the selected hunks
                        await this.gitService.stageSelectedHunks(
                            selectedHunks.map((hunk) => ({
                                file: hunk.file,
                                chunk: hunk.chunk,
                            })),
                        );

                        return {
                            success: true,
                            operation: 'stageHunks',
                            requestedIds: hunkIds,
                            stagedIds: selectedHunks.map((h) => h.hunkId),
                            missingIds,
                            stagedHunks: selectedHunks.length,
                            affectedFiles,
                            totalFiles: affectedFiles.length,
                            hasWarnings: missingIds.length > 0,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error staging hunks: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            operation: 'stageHunks',
                            requestedIds: hunkIds,
                        };
                    }
                },
            }),

            getFileCommitHistory: tool({
                description:
                    'Get the last N commit messages that affected a specific file to understand commit patterns and context.',
                inputSchema: z.object({
                    filePath: z.string().describe('Path to the file to get commit history for (relative to git root)'),
                    count: z.number().optional().describe('Number of recent commits to retrieve (default: 10)'),
                }),
                execute: async ({ filePath, count = 10 }) => {
                    onToolCall(`Getting commit history for file: ${filePath}`);

                    try {
                        const commits = await this.gitService.getFileCommitHistory(filePath, count);

                        return {
                            success: true,
                            filePath,
                            commits,
                            count: commits.length,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: `Error getting commit history for file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            filePath,
                        };
                    }
                },
            }),
        } as const;
    }

    private static getLineNumberFromChange(change: Change) {
        if (change.type === 'add' && 'ln2' in change && typeof change.ln2 === 'number') {
            return change.ln2;
        }
        if (change.type === 'del' && 'ln' in change && typeof change.ln === 'number') {
            return change.ln;
        }
        if ('ln2' in change) {
            return change.ln2;
        }
        if ('ln' in change) {
            return change.ln;
        }
        return 0;
    }
}
