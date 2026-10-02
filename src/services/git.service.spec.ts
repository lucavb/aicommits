import 'reflect-metadata';
import { Container } from 'inversify';
import { GitService, SIMPLE_GIT } from './git.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

class MockSimpleGit {
    add = vi.fn();
    commit = vi.fn();
    revparse = vi.fn();
    diff = vi.fn();
    log = vi.fn();
}

describe('GitService', () => {
    let gitService: GitService;
    let mockGit: MockSimpleGit;

    beforeEach(() => {
        mockGit = new MockSimpleGit();

        const container = new Container({ defaultScope: 'Singleton' });
        container.bind(SIMPLE_GIT).toConstantValue(mockGit);
        container.bind(GitService).toSelf();

        gitService = container.get(GitService);
    });

    describe('getRecentCommitMessages', () => {
        it('should return recent commit messages', async () => {
            const mockCommits = [
                { message: 'feat: add new feature' },
                { message: 'fix: resolve bug in component' },
                { message: 'docs: update README' },
                { message: 'refactor: improve code structure' },
                { message: 'test: add unit tests' },
            ];

            mockGit.log.mockResolvedValue({
                all: mockCommits,
            });

            const result = await gitService.getRecentCommitMessages(5);

            expect(result).toEqual([
                'feat: add new feature',
                'fix: resolve bug in component',
                'docs: update README',
                'refactor: improve code structure',
                'test: add unit tests',
            ]);
            expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 5, '--no-merges': null });
        });

        it('should return empty array when git log fails', async () => {
            mockGit.log.mockRejectedValue(new Error('Git error'));

            const result = await gitService.getRecentCommitMessages(5);

            expect(result).toEqual([]);
        });

        it('should filter out empty commit messages', async () => {
            const mockCommits = [
                { message: 'feat: add feature' },
                { message: '' },
                { message: 'fix: bug fix' },
                { message: null },
                { message: 'docs: update docs' },
            ];

            mockGit.log.mockResolvedValue({
                all: mockCommits,
            });

            const result = await gitService.getRecentCommitMessages(5);

            expect(result).toEqual(['feat: add feature', 'fix: bug fix', 'docs: update docs']);
        });

        it('should use default count of 5 when not specified', async () => {
            const mockCommits = [{ message: 'commit 1' }, { message: 'commit 2' }];

            mockGit.log.mockResolvedValue({
                all: mockCommits,
            });

            await gitService.getRecentCommitMessages();

            expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 5, '--no-merges': null });
        });

        it('should respect custom count parameter', async () => {
            const mockCommits = [{ message: 'commit 1' }, { message: 'commit 2' }, { message: 'commit 3' }];

            mockGit.log.mockResolvedValue({
                all: mockCommits,
            });

            await gitService.getRecentCommitMessages(3);

            expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 3, '--no-merges': null });
        });
    });

    describe('getStagedDiff', () => {
        it('passes every exclude pattern to both git diff calls', async () => {
            mockGit.diff.mockResolvedValueOnce('a.ts\nb.ts\n').mockResolvedValueOnce('diff --git a/a.ts');

            const result = await gitService.getStagedDiff(['*.lock', 'dist/**'], 4);

            expect(result).toEqual({ files: ['a.ts', 'b.ts'], diff: 'diff --git a/a.ts' });
            expect(mockGit.diff).toHaveBeenNthCalledWith(1, [
                '--cached',
                '--diff-algorithm=minimal',
                '--name-only',
                ':(exclude)*.lock',
                ':(exclude)dist/**',
            ]);
            expect(mockGit.diff).toHaveBeenNthCalledWith(2, [
                '-U4',
                '--cached',
                '--diff-algorithm=minimal',
                ':(exclude)*.lock',
                ':(exclude)dist/**',
            ]);
        });

        it('returns undefined when nothing is staged', async () => {
            mockGit.diff.mockResolvedValueOnce('');

            expect(await gitService.getStagedDiff([], 10)).toBeUndefined();
            expect(mockGit.diff).toHaveBeenCalledTimes(1);
        });

        it('writes nothing to stdout, because the hook prints its commit message there', async () => {
            const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            mockGit.diff.mockResolvedValueOnce('a.ts').mockResolvedValueOnce('diff');

            await gitService.getStagedDiff([], 10);

            expect(log).not.toHaveBeenCalled();
            log.mockRestore();
        });

        it('wraps git failures in a KnownError', async () => {
            mockGit.diff.mockRejectedValueOnce(new Error('boom'));

            await expect(gitService.getStagedDiff([], 10)).rejects.toThrow('Failed to get staged diff');
        });
    });

    describe('existing functionality', () => {
        it('should stage all files', async () => {
            mockGit.add.mockResolvedValue(undefined);

            await gitService.stageAllFiles();

            expect(mockGit.add).toHaveBeenCalledWith('.');
        });

        it('should throw error when staging fails', async () => {
            mockGit.add.mockRejectedValue(new Error('Git error'));

            await expect(gitService.stageAllFiles()).rejects.toThrow('Failed to stage all files');
        });
    });
});
