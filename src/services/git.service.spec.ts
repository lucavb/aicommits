import 'reflect-metadata';
import type { LogResult, SimpleGit, StatusResult } from 'simple-git';
import { GitService } from './git.service';
import type { ConfigService } from './config.service';
import { KnownError } from '../utils/error';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type GitIntegration = Pick<SimpleGit, 'add' | 'commit' | 'revparse' | 'diff' | 'log' | 'status' | 'reset'>;
type ConfigIntegration = Pick<
    ConfigService,
    'readConfig' | 'getGlobalIgnorePatterns' | 'setGlobalIgnorePatterns' | 'flush'
>;

class MockSimpleGit implements GitIntegration {
    add = vi.fn();
    commit = vi.fn();
    diff = vi.fn();
    log = vi.fn();
    reset = vi.fn();
    revparse = vi.fn();
    status = vi.fn();
}

class MockConfigService implements ConfigIntegration {
    flush = vi.fn();
    getGlobalIgnorePatterns = vi.fn();
    readConfig = vi.fn();
    setGlobalIgnorePatterns = vi.fn();
}

describe('GitService', () => {
    let gitService: GitService;
    let mockGit: MockSimpleGit;
    let mockConfigService: MockConfigService;

    beforeEach(() => {
        vi.clearAllMocks();

        mockGit = new MockSimpleGit();
        mockConfigService = new MockConfigService();

        // Set up default mock behaviors
        mockConfigService.readConfig.mockResolvedValue(undefined);
        mockConfigService.getGlobalIgnorePatterns.mockReturnValue(['package-lock.json', '*.lock']);
        mockConfigService.setGlobalIgnorePatterns.mockImplementation(() => undefined);
        mockConfigService.flush.mockResolvedValue(undefined);

        // Create GitService directly with mocked dependencies
        gitService = new GitService(mockGit, mockConfigService);
    });

    describe('stageAllFiles', () => {
        it('should stage all files successfully', async () => {
            mockGit.add.mockResolvedValue(undefined);

            await gitService.stageAllFiles();

            expect(mockGit.add).toHaveBeenCalledWith('.');
        });

        it('should throw error when staging fails', async () => {
            mockGit.add.mockRejectedValue(new Error('Git add failed'));

            await expect(gitService.stageAllFiles()).rejects.toThrow('Failed to stage all files');
        });
    });

    describe('commitChanges', () => {
        it('should commit changes successfully', async () => {
            const message = 'feat: add new feature';
            mockGit.commit.mockResolvedValue(undefined);

            await gitService.commitChanges(message);

            expect(mockGit.commit).toHaveBeenCalledWith(message);
        });

        it('should throw KnownError when commit fails', async () => {
            const message = 'feat: add new feature';
            mockGit.commit.mockRejectedValue(new Error('Git commit failed'));

            await expect(gitService.commitChanges(message)).rejects.toThrow(KnownError);
            await expect(gitService.commitChanges(message)).rejects.toThrow('Failed to commit changes');
        });
    });

    describe('assertGitRepo', () => {
        it('should return git repository root path', async () => {
            const repoPath = '/path/to/repo';
            mockGit.revparse.mockResolvedValue(repoPath + '\n');

            const result = await gitService.assertGitRepo();

            expect(result).toBe(repoPath);
            expect(mockGit.revparse).toHaveBeenCalledWith(['--show-toplevel']);
        });

        it('should throw KnownError when not in git repository', async () => {
            mockGit.revparse.mockRejectedValue(new Error('Not a git repository'));

            await expect(gitService.assertGitRepo()).rejects.toThrow(KnownError);
            await expect(gitService.assertGitRepo()).rejects.toThrow('The current directory must be a Git repository!');
        });
    });

    describe('getStagedDiff', () => {
        it('should return staged diff with files', async () => {
            const files = 'src/file1.ts\nsrc/file2.ts';
            const diff = 'diff --git a/src/file1.ts b/src/file1.ts\n+added line';

            mockGit.diff
                .mockResolvedValueOnce(files) // --name-only call
                .mockResolvedValueOnce(diff); // actual diff call

            const result = await gitService.getStagedDiff([], 3);

            expect(result).toEqual({
                files: ['src/file1.ts', 'src/file2.ts'],
                diff,
            });
        });

        it('should return undefined when no staged files', async () => {
            mockGit.diff.mockResolvedValue('');

            const result = await gitService.getStagedDiff([], 3);

            expect(result).toBeUndefined();
        });

        it('should initialize default ignore patterns when not configured', async () => {
            mockConfigService.getGlobalIgnorePatterns.mockReturnValue([]);
            const files = 'src/file1.ts';
            const diff = 'diff --git a/src/file1.ts b/src/file1.ts\n+added line';

            mockGit.diff.mockResolvedValueOnce(files).mockResolvedValueOnce(diff);

            await gitService.getStagedDiff([], 3);

            expect(mockConfigService.setGlobalIgnorePatterns).toHaveBeenCalledWith([
                'package-lock.json',
                'pnpm-lock.yaml',
                '*.lock',
            ]);
            expect(mockConfigService.flush).toHaveBeenCalled();
        });

        it('should throw KnownError when diff operation fails', async () => {
            mockGit.diff.mockRejectedValue(new Error('Git diff failed'));

            await expect(gitService.getStagedDiff([], 3)).rejects.toThrow(KnownError);
            await expect(gitService.getStagedDiff([], 3)).rejects.toThrow('Failed to get staged diff');
        });
    });

    describe('getWorkingDiff', () => {
        it('should return working directory diff', async () => {
            mockConfigService.getGlobalIgnorePatterns.mockReturnValue(['package-lock.json']);

            const diff = 'diff --git a/src/file1.ts b/src/file1.ts\n+added line';
            mockGit.diff.mockResolvedValue(diff);

            const result = await gitService.getWorkingDiff(3);

            expect(result).toBe(diff);
            expect(mockGit.diff).toHaveBeenCalledWith(['-U3', ':(exclude)package-lock.json']);
        });

        it('should return undefined when no working changes', async () => {
            mockConfigService.getGlobalIgnorePatterns.mockReturnValue(['package-lock.json']);
            mockGit.diff.mockResolvedValue('');

            const result = await gitService.getWorkingDiff(3);

            expect(result).toBeUndefined();
        });

        it('should throw KnownError when diff fails', async () => {
            mockConfigService.getGlobalIgnorePatterns.mockReturnValue(['package-lock.json']);
            mockGit.diff.mockRejectedValue(new Error('Git diff failed'));

            await expect(gitService.getWorkingDiff(3)).rejects.toThrow(KnownError);
            await expect(gitService.getWorkingDiff(3)).rejects.toThrow('Failed to get working directory diff');
        });
    });

    describe('stageFiles', () => {
        it('should stage specific files', async () => {
            const files = ['src/file1.ts', 'src/file2.ts'];
            mockGit.add.mockResolvedValue(undefined);

            await gitService.stageFiles(files);

            expect(mockGit.add).toHaveBeenCalledWith(files);
        });

        it('should throw KnownError when staging files fails', async () => {
            const files = ['src/file1.ts'];
            mockGit.add.mockRejectedValue(new Error('Git add failed'));

            await expect(gitService.stageFiles(files)).rejects.toThrow(KnownError);
            await expect(gitService.stageFiles(files)).rejects.toThrow('Failed to stage files');
        });
    });

    describe('unstageFiles', () => {
        it('should unstage specific files', async () => {
            const files = ['src/file1.ts', 'src/file2.ts'];
            mockGit.reset.mockResolvedValue(undefined);

            await gitService.unstageFiles(files);

            expect(mockGit.reset).toHaveBeenCalledWith(['HEAD', ...files]);
        });

        it('should throw KnownError when unstaging fails', async () => {
            const files = ['src/file1.ts'];
            mockGit.reset.mockRejectedValue(new Error('Git reset failed'));

            await expect(gitService.unstageFiles(files)).rejects.toThrow(KnownError);
            await expect(gitService.unstageFiles(files)).rejects.toThrow('Failed to unstage files');
        });
    });

    describe('getCommitHistory', () => {
        it('should return formatted commit history', async () => {
            const mockLog: LogResult = {
                all: [
                    {
                        hash: 'abcd1234567890',
                        message: 'feat: add new feature',
                        author_name: 'John Doe',
                        date: '2023-01-01',
                        author_email: 'john@example.com',
                        refs: '',
                        body: '',
                    },
                    {
                        hash: 'efgh5678901234',
                        message: 'fix: resolve bug',
                        author_name: 'Jane Smith',
                        date: '2023-01-02',
                        author_email: 'jane@example.com',
                        refs: '',
                        body: '',
                    },
                ],
                latest: null,
                total: 2,
            } as LogResult;

            mockGit.log.mockResolvedValue(mockLog);

            const result = await gitService.getCommitHistory(2);

            expect(result).toBe('abcd123 - feat: add new feature (John Doe)\nefgh567 - fix: resolve bug (Jane Smith)');
            expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 2 });
        });

        it('should throw KnownError when getting commit history fails', async () => {
            mockGit.log.mockRejectedValue(new Error('Git log failed'));

            await expect(gitService.getCommitHistory(5)).rejects.toThrow(KnownError);
            await expect(gitService.getCommitHistory(5)).rejects.toThrow('Failed to get commit history');
        });
    });

    describe('getFileCommitHistory', () => {
        it('should return file-specific commit history', async () => {
            const filePath = 'src/file1.ts';
            const mockLog: LogResult = {
                all: [
                    {
                        hash: 'abcd1234567890',
                        message: 'feat: update file1',
                        author_name: 'John Doe',
                        date: '2023-01-01T10:00:00Z',
                        author_email: 'john@example.com',
                        refs: '',
                        body: '',
                    },
                ],
                latest: null,
                total: 1,
            } as LogResult;

            mockGit.log.mockResolvedValue(mockLog);

            const result = await gitService.getFileCommitHistory(filePath, 1);

            expect(result).toEqual([
                {
                    hash: 'abcd123',
                    message: 'feat: update file1',
                    author: 'John Doe',
                    date: '2023-01-01T10:00:00Z',
                },
            ]);
            expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 1, file: filePath });
        });

        it('should handle missing author name', async () => {
            const filePath = 'src/file1.ts';
            const mockLog: LogResult = {
                all: [
                    {
                        hash: 'abcd1234567890',
                        message: 'feat: update file1',
                        author_name: '',
                        date: '2023-01-01T10:00:00Z',
                        author_email: 'unknown@example.com',
                        refs: '',
                        body: '',
                    },
                ],
                latest: null,
                total: 1,
            } as LogResult;

            mockGit.log.mockResolvedValue(mockLog);

            const result = await gitService.getFileCommitHistory(filePath, 1);

            expect(result[0].author).toBe('Unknown');
        });

        it('should throw KnownError when getting file history fails', async () => {
            const filePath = 'src/file1.ts';
            mockGit.log.mockRejectedValue(new Error('Git log failed'));

            await expect(gitService.getFileCommitHistory(filePath, 5)).rejects.toThrow(KnownError);
            await expect(gitService.getFileCommitHistory(filePath, 5)).rejects.toThrow(
                `Failed to get commit history for file: ${filePath}`,
            );
        });
    });

    describe('getStatus', () => {
        it('should return formatted git status', async () => {
            const mockStatus: StatusResult = {
                staged: ['staged-file.ts'],
                modified: ['modified-file.ts'],
                not_added: ['new-file.ts'],
                conflicted: [],
                created: [],
                deleted: [],
                renamed: [],
                files: [],
                ahead: 0,
                behind: 0,
                current: 'main',
                tracking: null,
                detached: false,
                isClean: () => false,
            };

            mockGit.status.mockResolvedValue(mockStatus);

            const result = await gitService.getStatus();

            expect(result).toContain('Staged files (1):');
            expect(result).toContain('  staged-file.ts');
            expect(result).toContain('Modified files (1):');
            expect(result).toContain('  modified-file.ts');
            expect(result).toContain('Untracked files (1):');
            expect(result).toContain('  new-file.ts');
        });

        it('should return "Working tree clean" when no changes', async () => {
            const mockStatus: StatusResult = {
                staged: [],
                modified: [],
                not_added: [],
                conflicted: [],
                created: [],
                deleted: [],
                renamed: [],
                files: [],
                ahead: 0,
                behind: 0,
                current: 'main',
                tracking: null,
                detached: false,
                isClean: () => true,
            };

            mockGit.status.mockResolvedValue(mockStatus);

            const result = await gitService.getStatus();

            expect(result).toBe('Working tree clean');
        });

        it('should throw KnownError when getting status fails', async () => {
            mockGit.status.mockRejectedValue(new Error('Git status failed'));

            await expect(gitService.getStatus()).rejects.toThrow(KnownError);
            await expect(gitService.getStatus()).rejects.toThrow('Failed to get git status');
        });
    });

    describe('resetAllStaged', () => {
        it('should reset all staged files', async () => {
            mockGit.reset.mockResolvedValue(undefined);

            await gitService.resetAllStaged();

            expect(mockGit.reset).toHaveBeenCalledWith(['HEAD']);
        });

        it('should throw KnownError when reset fails', async () => {
            mockGit.reset.mockRejectedValue(new Error('Git reset failed'));

            await expect(gitService.resetAllStaged()).rejects.toThrow(KnownError);
            await expect(gitService.resetAllStaged()).rejects.toThrow('Failed to reset staged files');
        });
    });

    describe('getStagedDiffForFiles', () => {
        it('should return diff for specific staged files', async () => {
            const files = ['src/file1.ts', 'src/file2.ts'];
            const stagedFiles = 'src/file1.ts\nsrc/file2.ts\nsrc/file3.ts';
            const diff = 'diff --git a/src/file1.ts b/src/file1.ts\n+added line';

            mockGit.diff
                .mockResolvedValueOnce(stagedFiles) // --name-only call
                .mockResolvedValueOnce(diff); // actual diff call

            const result = await gitService.getStagedDiffForFiles(files, 5);

            expect(result).toEqual({
                files: ['src/file1.ts', 'src/file2.ts'],
                diff,
            });
            expect(mockGit.diff).toHaveBeenCalledWith(['-U5', '--cached', '--diff-algorithm=minimal', '--', ...files]);
        });

        it('should filter out non-staged files', async () => {
            const files = ['src/file1.ts', 'src/file2.ts'];
            const stagedFiles = 'src/file1.ts'; // only file1 is staged
            const diff = 'diff --git a/src/file1.ts b/src/file1.ts\n+added line';

            mockGit.diff.mockResolvedValueOnce(stagedFiles).mockResolvedValueOnce(diff);

            const result = await gitService.getStagedDiffForFiles(files, 3);

            expect(result).toEqual({
                files: ['src/file1.ts'],
                diff,
            });
        });

        it('should return undefined when no requested files are staged', async () => {
            const files = ['src/file1.ts', 'src/file2.ts'];
            const stagedFiles = 'src/file3.ts'; // different files are staged

            mockGit.diff.mockResolvedValueOnce(stagedFiles);

            const result = await gitService.getStagedDiffForFiles(files, 3);

            expect(result).toBeUndefined();
        });

        it('should return undefined when no staged files at all', async () => {
            const files = ['src/file1.ts'];
            mockGit.diff.mockResolvedValueOnce('');

            const result = await gitService.getStagedDiffForFiles(files, 3);

            expect(result).toBeUndefined();
        });

        it('should throw KnownError when getting diff fails', async () => {
            const files = ['src/file1.ts'];
            mockGit.diff.mockRejectedValue(new Error('Git diff failed'));

            await expect(gitService.getStagedDiffForFiles(files, 3)).rejects.toThrow(KnownError);
            await expect(gitService.getStagedDiffForFiles(files, 3)).rejects.toThrow(
                'Failed to get staged diff for specific files',
            );
        });
    });

    describe('hasStagedChanges', () => {
        it('should return true when there are staged changes', async () => {
            mockGit.diff.mockResolvedValue('src/file1.ts\nsrc/file2.ts');

            const result = await gitService.hasStagedChanges();

            expect(result).toBe(true);
            expect(mockGit.diff).toHaveBeenCalledWith(['--cached', '--name-only']);
        });

        it('should return false when there are no staged changes', async () => {
            mockGit.diff.mockResolvedValue('');

            const result = await gitService.hasStagedChanges();

            expect(result).toBe(false);
        });

        it('should return false when diff returns whitespace only', async () => {
            mockGit.diff.mockResolvedValue('   \n  ');

            const result = await gitService.hasStagedChanges();

            expect(result).toBe(false);
        });

        it('should throw KnownError when checking staged changes fails', async () => {
            mockGit.diff.mockRejectedValue(new Error('Git diff failed'));

            await expect(gitService.hasStagedChanges()).rejects.toThrow(KnownError);
            await expect(gitService.hasStagedChanges()).rejects.toThrow('Failed to check for staged changes');
        });
    });

    describe('getWorkingChangesAsHunks', () => {
        it('should return empty array when no working changes', async () => {
            mockGit.diff.mockResolvedValue('');

            const result = await gitService.getWorkingChangesAsHunks();

            expect(result).toEqual([]);
            expect(mockGit.diff).toHaveBeenCalledWith(['--no-prefix']);
        });

        it('should parse working changes into hunks', async () => {
            const mockDiff = `diff --git a/src/file1.ts b/src/file1.ts
index abcd123..efgh456 100644
--- a/src/file1.ts
+++ b/src/file1.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;`;

            mockGit.diff.mockResolvedValue(mockDiff);

            const result = await gitService.getWorkingChangesAsHunks();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                file: 'src/file1.ts',
                hunkId: 'src/file1.ts_working_chunk_0',
                linesAdded: 1,
                linesRemoved: 0,
                oldStart: 1,
                newStart: 1,
            });
            expect(result[0].summary).toContain('const b = 2;');
        });

        it('should throw KnownError when getting working changes fails', async () => {
            mockGit.diff.mockRejectedValue(new Error('Git diff failed'));

            await expect(gitService.getWorkingChangesAsHunks()).rejects.toThrow(KnownError);
            await expect(gitService.getWorkingChangesAsHunks()).rejects.toThrow(
                'Failed to get working changes as hunks: Git diff failed',
            );
        });
    });

    describe('getStagedChangesAsHunks', () => {
        it('should return empty array when no staged changes', async () => {
            mockGit.diff.mockResolvedValue('');

            const result = await gitService.getStagedChangesAsHunks();

            expect(result).toEqual([]);
            expect(mockGit.diff).toHaveBeenCalledWith(['--cached', '--no-prefix']);
        });

        it('should parse staged changes into hunks', async () => {
            const mockDiff = `diff --git a/src/file1.ts b/src/file1.ts
index abcd123..efgh456 100644
--- a/src/file1.ts
+++ b/src/file1.ts
@@ -1,4 +1,3 @@
 const a = 1;
-const b = 2;
 const c = 3;`;

            mockGit.diff.mockResolvedValue(mockDiff);

            const result = await gitService.getStagedChangesAsHunks();

            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                file: 'src/file1.ts',
                hunkId: 'src/file1.ts_staged_chunk_0',
                linesAdded: 0,
                linesRemoved: 1,
                oldStart: 1,
                newStart: 1,
            });
            expect(result[0].summary).toContain('const b = 2;');
        });

        it('should throw KnownError when getting staged changes fails', async () => {
            mockGit.diff.mockRejectedValue(new Error('Git diff failed'));

            await expect(gitService.getStagedChangesAsHunks()).rejects.toThrow(KnownError);
            await expect(gitService.getStagedChangesAsHunks()).rejects.toThrow(
                'Failed to get staged changes as hunks: Git diff failed',
            );
        });
    });

    describe('stageSelectedHunks', () => {
        it('should reset staging and stage files containing selected hunks', async () => {
            const selectedHunks = [
                {
                    file: 'src/file1.ts',
                    chunk: {} as never, // Mock chunk object
                },
                {
                    file: 'src/file2.ts',
                    chunk: {} as never,
                },
                {
                    file: 'src/file1.ts', // duplicate file
                    chunk: {} as never,
                },
            ];

            mockGit.reset.mockResolvedValue(undefined);
            mockGit.add.mockResolvedValue(undefined);

            await gitService.stageSelectedHunks(selectedHunks);

            expect(mockGit.reset).toHaveBeenCalledWith(['HEAD']);
            expect(mockGit.add).toHaveBeenCalledWith(['src/file1.ts', 'src/file2.ts']);
        });

        it('should throw KnownError when staging hunks fails', async () => {
            const selectedHunks = [
                {
                    file: 'src/file1.ts',
                    chunk: {} as never,
                },
            ];

            mockGit.reset.mockRejectedValue(new Error('Git reset failed'));

            await expect(gitService.stageSelectedHunks(selectedHunks)).rejects.toThrow(KnownError);
            await expect(gitService.stageSelectedHunks(selectedHunks)).rejects.toThrow(
                'Failed to stage selected hunks: Failed to reset staged files',
            );
        });
    });

    describe('getDetectedMessage', () => {
        it('should return singular message for one file', () => {
            const files = ['file1.ts'];
            const result = gitService.getDetectedMessage(files);
            expect(result).toBe('Detected 1 staged file');
        });

        it('should return plural message for multiple files', () => {
            const files = ['file1.ts', 'file2.ts', 'file3.ts'];
            const result = gitService.getDetectedMessage(files);
            expect(result).toBe('Detected 3 staged files');
        });

        it('should format large numbers with locale string', () => {
            const files = new Array(1500).fill('file.ts');
            const result = gitService.getDetectedMessage(files);
            expect(result).toContain('1,500'); // Assuming US locale formatting
        });
    });
});
