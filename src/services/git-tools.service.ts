import { z } from 'zod';
import { Inject, Injectable } from '../utils/inversify';
import { GitService } from './git.service';
import { tool } from 'ai';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class GitToolsService {
    constructor(@Inject(GitService) private readonly gitService: GitService) {}

    createTools() {
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
                    const contextLinesValue = contextLines ?? 3;
                    try {
                        if (type === 'staged') {
                            const staged = await this.gitService.getStagedDiff([], contextLinesValue);
                            if (!staged) {
                                return 'No staged changes found.';
                            }
                            return `Staged files:\n${staged.files.join('\n')}\n\nDiff:\n${staged.diff}`;
                        } else {
                            const diff = await this.gitService.getWorkingDiff(contextLinesValue);
                            if (!diff) {
                                return 'No unstaged changes found.';
                            }
                            return `Working directory diff:\n${diff}`;
                        }
                    } catch (error) {
                        return `Error getting diff: ${error instanceof Error ? error.message : 'Unknown error'}`;
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
                    const directoryValue = directory ?? '.';
                    const includeHiddenValue = includeHidden ?? false;
                    try {
                        const gitRoot = await this.gitService.assertGitRepo();
                        const fullPath = join(gitRoot, directoryValue);

                        const items = await readdir(fullPath);
                        const result: string[] = [];

                        for (const item of items) {
                            if (!includeHiddenValue && item.startsWith('.')) {
                                continue;
                            }

                            const itemPath = join(fullPath, item);
                            const stats = await stat(itemPath);
                            const type = stats.isDirectory() ? 'dir' : 'file';
                            result.push(`${type}: ${item}`);
                        }

                        return result.length > 0 ? result.join('\n') : 'Directory is empty.';
                    } catch (error) {
                        return `Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    }
                },
            }),

            getStagedFiles: tool({
                description: 'Get list of files that are currently staged for commit.',
                inputSchema: z.object({}),
                execute: async () => {
                    try {
                        const staged = await this.gitService.getStagedDiff([], 0);
                        if (!staged) {
                            return 'No files are currently staged.';
                        }
                        return `Staged files (${staged.files.length}):\n${staged.files.join('\n')}`;
                    } catch (error) {
                        return `Error getting staged files: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    }
                },
            }),

            stageFiles: tool({
                description: 'Stage specific files for commit.',
                inputSchema: z.object({
                    files: z.array(z.string()).describe('Array of file paths to stage'),
                }),
                execute: async ({ files }) => {
                    try {
                        await this.gitService.stageFiles(files);
                        return `Successfully staged ${files.length} file(s): ${files.join(', ')}`;
                    } catch (error) {
                        return `Error staging files: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    }
                },
            }),

            unstageFiles: tool({
                description: 'Unstage specific files.',
                inputSchema: z.object({
                    files: z.array(z.string()).describe('Array of file paths to unstage'),
                }),
                execute: async ({ files }) => {
                    try {
                        await this.gitService.unstageFiles(files);
                        return `Successfully unstaged ${files.length} file(s): ${files.join(', ')}`;
                    } catch (error) {
                        return `Error unstaging files: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    }
                },
            }),

            getFileContent: tool({
                description: 'Get the content of a specific file.',
                inputSchema: z.object({
                    filePath: z.string().describe('Path to the file to read (relative to git root)'),
                    maxLines: z.number().optional().describe('Maximum number of lines to return'),
                }),
                execute: async ({ filePath, maxLines }) => {
                    const maxLinesValue = maxLines ?? 100;
                    try {
                        const gitRoot = await this.gitService.assertGitRepo();
                        const fullPath = join(gitRoot, filePath);

                        const content = await readFile(fullPath, 'utf-8');
                        const lines = content.split('\n');

                        if (lines.length <= maxLinesValue) {
                            return content;
                        }

                        const truncatedContent = lines.slice(0, maxLinesValue).join('\n');
                        return `${truncatedContent}\n\n... (truncated, showing first ${maxLinesValue} lines of ${lines.length} total lines)`;
                    } catch (error) {
                        return `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    }
                },
            }),

            getCommitHistory: tool({
                description: 'Get recent commit history for context.',
                inputSchema: z.object({
                    count: z.number().optional().describe('Number of recent commits to retrieve'),
                }),
                execute: async ({ count }) => {
                    const countValue = count ?? 5;
                    try {
                        return this.gitService.getCommitHistory(countValue);
                    } catch (error) {
                        return `Error getting commit history: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    }
                },
            }),

            getStatus: tool({
                description: 'Get current git status showing staged, unstaged, and untracked files.',
                inputSchema: z.object({}),
                execute: async () => {
                    try {
                        return this.gitService.getStatus();
                    } catch (error) {
                        return `Error getting git status: ${error instanceof Error ? error.message : 'Unknown error'}`;
                    }
                },
            }),
        } as const;
    }
}
