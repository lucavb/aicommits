import 'reflect-metadata';
import { Container } from 'inversify';
import { GitService, SIMPLE_GIT } from './git.service';
import { ConfigService } from './config.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injectable } from '../utils/inversify';

@Injectable()
class MockConfigService implements Partial<ConfigService> {
    readConfig = vi.fn().mockResolvedValue(undefined);
    getGlobalIgnorePatterns = vi.fn().mockReturnValue([]);
    setGlobalIgnorePatterns = vi.fn();
    flush = vi.fn().mockResolvedValue(undefined);
}

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
        container.bind(ConfigService).to(MockConfigService as unknown as typeof ConfigService);
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
