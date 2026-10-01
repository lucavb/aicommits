import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Container } from 'inversify';
import { simpleGit, type SimpleGit } from 'simple-git';
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
    raw = vi.fn();
}

describe('GitService', () => {
    let gitService: GitService;
    let mockGit: MockSimpleGit;
    let mockConfigService: MockConfigService;

    beforeEach(() => {
        mockGit = new MockSimpleGit();
        mockConfigService = new MockConfigService();

        const container = new Container({ defaultScope: 'Singleton' });
        container.bind(ConfigService).toConstantValue(mockConfigService as unknown as ConfigService);
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

    describe('commitChanges (binds the commit to the reviewed file set)', () => {
        it('commits with an explicit --only pathspec bound to the reviewed files and discloses the committed set', async () => {
            mockGit.diff.mockResolvedValue('a.ts\nREADME.md\n');
            mockGit.commit.mockResolvedValue({ commit: 'abc123', branch: 'main', root: false, summary: {} });
            mockGit.raw.mockResolvedValue('a.ts\nREADME.md\n');

            const result = await gitService.commitChanges('feat: reviewed', ['a.ts', 'README.md']);

            expect(mockGit.commit).toHaveBeenCalledWith('feat: reviewed', ['a.ts', 'README.md'], { '--only': null });
            expect(mockGit.raw).toHaveBeenCalledWith(['show', '--pretty=format:', '--name-only', 'abc123']);
            expect(result.files).toEqual(['a.ts', 'README.md']);
            expect(result.commit).toBe('abc123');
        });

        it('still returns the commit result when the committed-file disclosure read fails', async () => {
            mockGit.diff.mockResolvedValue('a.ts\n');
            mockGit.commit.mockResolvedValue({ commit: 'abc123', branch: 'main', root: false, summary: {} });
            mockGit.raw.mockRejectedValue(new Error('show failed'));

            const result = await gitService.commitChanges('feat: reviewed', ['a.ts']);

            expect(result.commit).toBe('abc123');
            expect(result.files).toEqual([]);
        });

        it('rejects and does not commit when the index holds files outside the reviewed set', async () => {
            // Index contains a staged attacker-crafted lockfile the review artifact never showed.
            mockGit.diff.mockResolvedValue('README.md\napp.ts\npackage-lock.json\n');

            await expect(gitService.commitChanges('feat: approved message', ['README.md', 'app.ts'])).rejects.toThrow(
                'staged index changed since review',
            );
            expect(mockGit.commit).not.toHaveBeenCalled();
        });

        it('rejects when a reviewed file is no longer staged at commit time', async () => {
            mockGit.diff.mockResolvedValue('a.ts\n');

            await expect(gitService.commitChanges('feat: reviewed', ['a.ts', 'b.ts'])).rejects.toThrow(
                'staged index changed since review',
            );
            expect(mockGit.commit).not.toHaveBeenCalled();
        });

        it('rejects an empty reviewed file set', async () => {
            await expect(gitService.commitChanges('feat: reviewed', [])).rejects.toThrow('No reviewed files to commit');
            expect(mockGit.commit).not.toHaveBeenCalled();
        });

        it('wraps unknown commit failures in a KnownError', async () => {
            mockGit.diff.mockResolvedValue('a.ts\n');
            mockGit.commit.mockRejectedValue(new Error('git crashed'));

            await expect(gitService.commitChanges('feat: reviewed', ['a.ts'])).rejects.toThrow(
                'Failed to commit changes',
            );
        });
    });

    describe('getStagedDiff (approval artifact disclosure)', () => {
        it('discloses index files the exclusion pathspecs filtered out of the artifact', async () => {
            mockConfigService.getGlobalIgnorePatterns = vi.fn().mockReturnValue(['package-lock.json']);
            mockGit.diff.mockImplementation((args: readonly string[]) => {
                const isNameOnly = args.includes('--name-only');
                const hasExcludes = args.some((arg) => typeof arg === 'string' && arg.startsWith(':(exclude)'));
                if (isNameOnly && !hasExcludes) {
                    return Promise.resolve('app.ts\nREADME.md\npackage-lock.json\n');
                }
                if (isNameOnly) {
                    return Promise.resolve('app.ts\nREADME.md\n');
                }
                return Promise.resolve('diff --git a/app.ts');
            });

            const staged = await gitService.getStagedDiff([], 3);

            expect(staged?.files).toEqual(['app.ts', 'README.md']);
            expect(staged?.filesExcludedFromReview).toEqual(['package-lock.json']);
        });

        it('returns no filesExcludedFromReview when nothing was filtered out', async () => {
            mockGit.diff.mockImplementation((args: readonly string[]) => {
                if (args.includes('--name-only')) {
                    return Promise.resolve('app.ts\n');
                }
                return Promise.resolve('diff --git a/app.ts');
            });

            const staged = await gitService.getStagedDiff([], 3);

            expect(staged?.files).toEqual(['app.ts']);
            expect(staged?.filesExcludedFromReview).toEqual([]);
        });

        it('returns undefined when the filtered review list is empty', async () => {
            // Fail-closed: staging only an ignored artifact leaves nothing to
            // review, so getStagedDiff must return undefined (no reviewable set,
            // no commit can proceed). The exclude pathspec only exists when the
            // ignore patterns are configured.
            mockConfigService.getGlobalIgnorePatterns = vi.fn().mockReturnValue(['package-lock.json']);
            mockGit.diff.mockImplementation((args: readonly string[]) => {
                const isNameOnly = args.includes('--name-only');
                const hasExcludes = args.some((arg) => typeof arg === 'string' && arg.startsWith(':(exclude)'));
                if (isNameOnly && !hasExcludes) {
                    return Promise.resolve('package-lock.json\n');
                }
                if (isNameOnly) {
                    return Promise.resolve('');
                }
                return Promise.resolve('');
            });

            const staged = await gitService.getStagedDiff([], 3);

            expect(staged).toBeUndefined();
        });
    });

    describe('default ignore patterns consent gate', () => {
        it('does not auto-initialize or persist tool defaults without a consent callback', async () => {
            mockConfigService.getGlobalIgnorePatterns = vi.fn().mockReturnValue([]);
            mockGit.diff.mockResolvedValue('a.ts\n');

            await gitService.getStagedDiff([], 3);

            expect(mockConfigService.setGlobalIgnorePatterns).not.toHaveBeenCalled();
            expect(mockConfigService.flush).not.toHaveBeenCalled();
            expect(mockGit.diff).toHaveBeenCalledWith(['--cached', '--diff-algorithm=minimal', '--name-only']);
        });

        it('does not initialize or persist tool defaults when consent is declined', async () => {
            mockConfigService.getGlobalIgnorePatterns = vi.fn().mockReturnValue([]);
            mockGit.diff.mockResolvedValue('a.ts\n');

            await gitService.getStagedDiff([], 3, { requestDefaultIgnoreConsent: async () => false });

            expect(mockConfigService.setGlobalIgnorePatterns).not.toHaveBeenCalled();
            expect(mockConfigService.flush).not.toHaveBeenCalled();
        });

        it('initializes and persists the defaults only after explicit consent', async () => {
            mockConfigService.getGlobalIgnorePatterns = vi.fn().mockReturnValue([]);
            mockGit.diff.mockResolvedValue('a.ts\n');

            await gitService.getStagedDiff([], 3, { requestDefaultIgnoreConsent: async () => true });

            expect(mockConfigService.setGlobalIgnorePatterns).toHaveBeenCalledWith([
                'package-lock.json',
                'pnpm-lock.yaml',
                '*.lock',
            ]);
            expect(mockConfigService.flush).toHaveBeenCalled();
        });

        it('applies user-configured ignore patterns without any consent round-trip', async () => {
            mockConfigService.getGlobalIgnorePatterns = vi.fn().mockReturnValue(['package-lock.json']);
            mockGit.diff.mockResolvedValue('a.ts\n');

            await gitService.getStagedDiff([], 3);

            expect(mockConfigService.setGlobalIgnorePatterns).not.toHaveBeenCalled();
            expect(mockConfigService.flush).not.toHaveBeenCalled();
            // First diff call lists the full index; second call applies the exclude pathspecs.
            const [, filteredCall] = mockGit.diff.mock.calls;
            expect(filteredCall[0]).toContain(':(exclude)package-lock.json');
        });
    });
});

/**
 * Integration tests against a real git binary in a unique throwaway workspace:
 * a staged file matching a default exclude pattern must either be disclosed and
 * consented or excluded from the commit; commitChanges with a reviewed file set
 * never commits an index file outside that set.
 */
const gitAvailable = (() => {
    try {
        execFileSync('git', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

const CRAFTED_PACKAGE_LOCK = JSON.stringify(
    {
        name: 'evil',
        lockfileVersion: 3,
        packages: {
            '': {
                name: 'evil',
                resolved: 'http://127.0.0.1:1/evil.tgz',
                integrity: 'sha512-DUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY',
            },
        },
    },
    null,
    2,
);

async function createDummyRepo(): Promise<{ dir: string; repo: SimpleGit }> {
    const dir = mkdtempSync(join(tmpdir(), 'aicommits-git-service-'));
    const repo = simpleGit({
        baseDir: dir,
        // `config` is typed as string[] (per-command `-c` args) — one entry per key.
        config: ['user.name=probe', 'user.email=probe@example.invalid', 'commit.gpgsign=false'],
    });
    await repo.init();
    writeFileSync(join(dir, 'seed.txt'), 'seed\n', 'utf8');
    await repo.add(['seed.txt']);
    await repo.commit('chore: seed');
    return { dir, repo };
}

async function buildGitService(repo: SimpleGit, globalIgnore: string[] = []): Promise<GitService> {
    const mockConfigService = new MockConfigService();
    mockConfigService.getGlobalIgnorePatterns = vi.fn().mockReturnValue(globalIgnore);
    const container = new Container({ defaultScope: 'Singleton' });
    container.bind(ConfigService).toConstantValue(mockConfigService as unknown as ConfigService);
    container.bind(SIMPLE_GIT).toConstantValue(repo);
    container.bind(GitService).toSelf();
    return container.get(GitService);
}

describe.skipIf(!gitAvailable)('GitService commit binding (real git)', () => {
    let dir: string;
    let repo: SimpleGit;
    let gitService: GitService;

    beforeEach(async () => {
        ({ dir, repo } = await createDummyRepo());
        gitService = await buildGitService(repo);
    });

    it('commits exactly the reviewed file set when the index matches it', async () => {
        writeFileSync(join(dir, 'README.md'), 'docs\n', 'utf8');
        writeFileSync(join(dir, 'app.ts'), 'export {};\n', 'utf8');
        await repo.add(['README.md', 'app.ts']);

        const committed = await gitService.commitChanges('feat: approved message', ['README.md', 'app.ts']);

        expect(committed.files.sort()).toEqual(['README.md', 'app.ts']);
        const shown = await repo.raw(['show', '--pretty=format:', '--name-only', 'HEAD']);
        // git show lists committed files in index traversal order; compare as an
        // exact set (same members, nothing more, nothing less) not insertion order.
        expect(shown.split('\n').filter(Boolean).sort()).toEqual(['README.md', 'app.ts'].sort());
    });

    it('aborts when the index holds a staged default-excluded file outside the reviewed set and commits nothing', async () => {
        writeFileSync(join(dir, 'README.md'), 'docs\n', 'utf8');
        writeFileSync(join(dir, 'app.ts'), 'export {};\n', 'utf8');
        writeFileSync(join(dir, 'package-lock.json'), CRAFTED_PACKAGE_LOCK, 'utf8');
        // Exactly what --stage-all does: stage the entire working tree.
        await gitService.stageAllFiles();

        const baseline = (await repo.log({ maxCount: 1 })).latest?.message;
        expect(baseline).toBe('chore: seed');

        // Reviewed files only - the staged lockfile was never consented for the commit.
        await expect(gitService.commitChanges('feat: approved message', ['README.md', 'app.ts'])).rejects.toThrow(
            'staged index changed since review',
        );
        expect((await repo.log({ maxCount: 1 })).latest?.message).toBe('chore: seed');
    });

    it('excludes staged excluded files from the artifact with consent and discloses them as excluded', async () => {
        writeFileSync(join(dir, 'README.md'), 'docs\n', 'utf8');
        writeFileSync(join(dir, 'package-lock.json'), CRAFTED_PACKAGE_LOCK, 'utf8');
        await gitService.stageAllFiles();

        // Consent granted: the tool initializes and persists its defaults.
        const consentedService = await buildGitService(repo);
        const consented = await consentedService.getStagedDiff([], 3, {
            requestDefaultIgnoreConsent: async () => true,
        });

        expect(consented?.files).toEqual(['README.md']);
        expect(consented?.filesExcludedFromReview).toEqual(['package-lock.json']);
        const excluded = consented?.filesExcludedFromReview ?? [];
        expect(consented?.files.filter((file) => excluded.includes(file))).toEqual([]);
    });

    it('shows default-exclude-matching staged files for review when consent is declined', async () => {
        writeFileSync(join(dir, 'README.md'), 'docs\n', 'utf8');
        writeFileSync(join(dir, 'package-lock.json'), CRAFTED_PACKAGE_LOCK, 'utf8');
        await gitService.stageAllFiles();

        const staged = await gitService.getStagedDiff([], 3);

        // Without consent nothing is hidden: the lockfile is visible for review.
        expect(staged?.files).toEqual(['README.md', 'package-lock.json']);
        expect(staged?.filesExcludedFromReview).toEqual([]);
    });
});
