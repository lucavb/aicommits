import { GitService, BranchStatus } from './git.service';
import { ConfigService } from './config.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock simple-git
const mockGit = {
    revparse: vi.fn(),
    getRemotes: vi.fn(),
    raw: vi.fn(),
    branchLocal: vi.fn(),
    branch: vi.fn(),
    fetch: vi.fn(),
    diff: vi.fn(),
};

// Mock ConfigService
const mockConfigService = {
    readConfig: vi.fn(),
    getGlobalIgnorePatterns: vi.fn(),
    setGlobalIgnorePatterns: vi.fn(),
    flush: vi.fn(),
} as unknown as ConfigService;

describe('GitService - Branch and Remote Operations', () => {
    let gitService: GitService;

    beforeEach(() => {
        // Reset all mocks first
        vi.clearAllMocks();
        
        // Default mock implementations
        mockConfigService.readConfig = vi.fn().mockResolvedValue(undefined);
        mockConfigService.getGlobalIgnorePatterns = vi.fn().mockReturnValue(['package-lock.json']);
        mockConfigService.setGlobalIgnorePatterns = vi.fn().mockReturnValue(undefined);
        mockConfigService.flush = vi.fn().mockResolvedValue(undefined);

        // Create GitService instance directly with mocked dependencies
        gitService = new GitService(mockGit as any, mockConfigService);
    });

    describe('getCurrentBranch', () => {
        it('should return the current branch name', async () => {
            mockGit.revparse.mockResolvedValue('feature-branch\n');

            const result = await gitService.getCurrentBranch();

            expect(result).toBe('feature-branch');
            expect(mockGit.revparse).toHaveBeenCalledWith(['--abbrev-ref', 'HEAD']);
        });

        it('should throw KnownError when git command fails', async () => {
            mockGit.revparse.mockRejectedValue(new Error('Git error'));

            await expect(gitService.getCurrentBranch()).rejects.toThrow('Failed to get current branch');
        });
    });

    describe('getDefaultBranch', () => {
        it('should return main when it exists locally', async () => {
            mockGit.getRemotes.mockResolvedValue([]);
            mockGit.branchLocal.mockResolvedValue({
                all: ['main', 'feature-branch'],
                current: 'feature-branch',
            });

            const result = await gitService.getDefaultBranch();

            expect(result).toBe('main');
        });

        it('should return master when main does not exist but master does', async () => {
            mockGit.getRemotes.mockResolvedValue([]);
            mockGit.branchLocal.mockResolvedValue({
                all: ['master', 'feature-branch'],
                current: 'feature-branch',
            });

            const result = await gitService.getDefaultBranch();

            expect(result).toBe('master');
        });

        it('should return default branch from remote HEAD when available', async () => {
            mockGit.getRemotes.mockResolvedValue([
                { name: 'origin', refs: { fetch: 'https://github.com/user/repo.git' } },
            ]);
            mockGit.raw.mockResolvedValue('refs/remotes/origin/main\n');
            mockGit.branchLocal.mockResolvedValue({
                all: ['feature-branch'],
                current: 'feature-branch',
            });

            const result = await gitService.getDefaultBranch();

            expect(result).toBe('main');
            expect(mockGit.raw).toHaveBeenCalledWith(['symbolic-ref', 'refs/remotes/origin/HEAD']);
        });

        it('should fallback to current branch when no main/master exists', async () => {
            mockGit.getRemotes.mockResolvedValue([]);
            mockGit.branchLocal.mockResolvedValue({
                all: ['feature-branch', 'develop'],
                current: 'feature-branch',
            });

            const result = await gitService.getDefaultBranch();

            expect(result).toBe('feature-branch');
        });

        it('should throw KnownError when git command fails', async () => {
            mockGit.getRemotes.mockRejectedValue(new Error('Git error'));

            await expect(gitService.getDefaultBranch()).rejects.toThrow('Failed to determine default branch');
        });
    });

    describe('getBranchTrackingStatus', () => {
        it('should return tracking status for branch with remote', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['main', 'feature-branch'],
                current: 'feature-branch',
            });
            mockGit.raw
                .mockResolvedValueOnce('origin/feature-branch\n') // tracking branch
                .mockResolvedValueOnce('2\t1\n'); // ahead/behind counts

            const result = await gitService.getBranchTrackingStatus('feature-branch');

            expect(result).toEqual({
                ahead: 2,
                behind: 1,
                upToDate: false,
                hasRemote: true,
            });
        });

        it('should return no remote status for branch without tracking', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['main', 'feature-branch'],
                current: 'feature-branch',
            });
            mockGit.raw.mockRejectedValueOnce(new Error('No upstream')); // no tracking branch

            const result = await gitService.getBranchTrackingStatus('feature-branch');

            expect(result).toEqual({
                ahead: 0,
                behind: 0,
                upToDate: true,
                hasRemote: false,
            });
        });

        it('should return up to date status when ahead/behind are 0', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['main', 'feature-branch'],
                current: 'feature-branch',
            });
            mockGit.raw
                .mockResolvedValueOnce('origin/feature-branch\n') // tracking branch
                .mockResolvedValueOnce('0\t0\n'); // ahead/behind counts

            const result = await gitService.getBranchTrackingStatus('feature-branch');

            expect(result).toEqual({
                ahead: 0,
                behind: 0,
                upToDate: true,
                hasRemote: true,
            });
        });

        it('should throw KnownError for non-existent branch', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['main'],
                current: 'main',
            });

            await expect(gitService.getBranchTrackingStatus('non-existent')).rejects.toThrow(
                "Branch 'non-existent' does not exist"
            );
        });
    });

    describe('fetchFromRemote', () => {
        it('should fetch from remote successfully', async () => {
            mockGit.fetch.mockResolvedValue(undefined);

            await gitService.fetchFromRemote();

            expect(mockGit.fetch).toHaveBeenCalledWith();
        });

        it('should throw KnownError when fetch fails', async () => {
            mockGit.fetch.mockRejectedValue(new Error('Network error'));

            await expect(gitService.fetchFromRemote()).rejects.toThrow('Failed to fetch from remote');
        });
    });

    describe('getCommitHash', () => {
        it('should return commit hash for a branch', async () => {
            mockGit.revparse.mockResolvedValue('abc123def456\n');

            const result = await gitService.getCommitHash('main');

            expect(result).toBe('abc123def456');
            expect(mockGit.revparse).toHaveBeenCalledWith(['main']);
        });

        it('should throw KnownError when commit hash cannot be retrieved', async () => {
            mockGit.revparse.mockRejectedValue(new Error('Invalid ref'));

            await expect(gitService.getCommitHash('nonexistent')).rejects.toThrow(
                "Failed to get commit hash for 'nonexistent'"
            );
        });
    });

    describe('validateBranchExists', () => {
        it('should pass when branch exists locally', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['main', 'feature-branch'],
                current: 'main',
            });

            await expect(gitService.validateBranchExists('main')).resolves.toBeUndefined();
        });

        it('should pass when branch exists remotely', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['feature-branch'],
                current: 'feature-branch',
            });
            mockGit.branch.mockResolvedValue({
                all: ['origin/main', 'origin/develop'],
            });

            await expect(gitService.validateBranchExists('main')).resolves.toBeUndefined();
        });

        it('should pass when branch exists as remote reference', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['feature-branch'],
                current: 'feature-branch',
            });
            mockGit.branch.mockResolvedValue({
                all: ['origin/main', 'origin/develop'],
            });

            await expect(gitService.validateBranchExists('develop')).resolves.toBeUndefined();
        });

        it('should throw KnownError when branch does not exist', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['main'],
                current: 'main',
            });
            mockGit.branch.mockResolvedValue({
                all: ['origin/main'],
            });

            await expect(gitService.validateBranchExists('nonexistent')).rejects.toThrow(
                "Branch 'nonexistent' does not exist locally or remotely"
            );
        });

        it('should throw KnownError when git commands fail', async () => {
            mockGit.branchLocal.mockRejectedValue(new Error('Git error'));

            await expect(gitService.validateBranchExists('main')).rejects.toThrow(
                "Failed to validate branch 'main'"
            );
        });
    });

    describe('getBranchDiff', () => {
        beforeEach(() => {
            // Mock the getFilesToExclude method dependencies
            mockConfigService.readConfig.mockResolvedValue(undefined);
            mockConfigService.getGlobalIgnorePatterns.mockReturnValue(['package-lock.json']);
            mockConfigService.setGlobalIgnorePatterns.mockReturnValue(undefined);
            mockConfigService.flush.mockResolvedValue(undefined);
        });

        it('should return diff between two branches', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['main', 'feature-branch'],
                current: 'feature-branch',
            });
            mockGit.branch.mockResolvedValue({
                all: ['origin/main', 'origin/feature-branch'],
            });
            mockGit.diff
                .mockResolvedValueOnce('file1.ts\nfile2.ts\n') // files changed
                .mockResolvedValueOnce('diff content here'); // actual diff

            const result = await gitService.getBranchDiff('main', 'feature-branch');

            expect(result).toEqual({
                files: ['file1.ts', 'file2.ts'],
                diff: 'diff content here',
            });
            expect(mockGit.diff).toHaveBeenCalledWith(['main...feature-branch', '--name-only']);
            expect(mockGit.diff).toHaveBeenCalledWith([
                'main...feature-branch',
                '--diff-algorithm=minimal',
                ':(exclude)package-lock.json',
            ]);
        });

        it('should return empty result when no differences', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['main', 'feature-branch'],
                current: 'feature-branch',
            });
            mockGit.branch.mockResolvedValue({
                all: ['origin/main', 'origin/feature-branch'],
            });
            mockGit.diff.mockResolvedValueOnce(''); // no files changed

            const result = await gitService.getBranchDiff('main', 'feature-branch');

            expect(result).toEqual({
                files: [],
                diff: '',
            });
        });

        it('should work with remote branches', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['feature-branch'],
                current: 'feature-branch',
            });
            mockGit.branch.mockResolvedValue({
                all: ['origin/main', 'origin/feature-branch'],
            });
            mockGit.diff
                .mockResolvedValueOnce('file1.ts\n') // files changed
                .mockResolvedValueOnce('diff content'); // actual diff

            const result = await gitService.getBranchDiff('main', 'feature-branch');

            expect(result).toEqual({
                files: ['file1.ts'],
                diff: 'diff content',
            });
            expect(mockGit.diff).toHaveBeenCalledWith(['main...feature-branch', '--name-only']);
            expect(mockGit.diff).toHaveBeenCalledWith([
                'main...feature-branch',
                '--diff-algorithm=minimal',
                ':(exclude)package-lock.json',
            ]);
        });

        it('should throw KnownError for non-existent base branch', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['feature-branch'],
                current: 'feature-branch',
            });
            mockGit.branch.mockResolvedValue({
                all: ['origin/feature-branch'],
            });

            await expect(gitService.getBranchDiff('non-existent', 'feature-branch')).rejects.toThrow(
                "Base branch 'non-existent' does not exist"
            );
        });

        it('should throw KnownError for non-existent head branch', async () => {
            mockGit.branchLocal.mockResolvedValue({
                all: ['main'],
                current: 'main',
            });
            mockGit.branch.mockResolvedValue({
                all: ['origin/main'],
            });

            await expect(gitService.getBranchDiff('main', 'non-existent')).rejects.toThrow(
                "Head branch 'non-existent' does not exist"
            );
        });
    });
});