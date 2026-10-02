import type { CommitResult, SimpleGit } from 'simple-git';
import { Inject, Injectable } from '../utils/inversify';
import { KnownError } from '../utils/error';

export const SIMPLE_GIT = Symbol.for('SIMPLE_GIT');

@Injectable()
export class GitService {
    constructor(@Inject(SIMPLE_GIT) private readonly git: SimpleGit) {}

    async stageAllFiles(): Promise<void> {
        try {
            await this.git.add('.');
        } catch {
            throw new Error('Failed to stage all files');
        }
    }

    async commitChanges(message: string, reviewedFiles: string[]): Promise<CommitResult & { files: string[] }> {
        if (reviewedFiles.length === 0) {
            throw new KnownError('No reviewed files to commit.');
        }

        try {
            // Re-verify the index against the reviewed file-set snapshot: the
            // commit must contain exactly the reviewed files, nothing beyond
            // them (index entries added after the review) and nothing fewer
            // (reviewed files unstaged after the review).
            const stagedNow = (await this.git.diff(['--cached', '--name-only'])).split('\n').filter(Boolean);
            const reviewed = new Set(reviewedFiles);
            const unreviewed = stagedNow.filter((file) => !reviewed.has(file));
            const unstagedSinceReview = reviewedFiles.filter((file) => !stagedNow.includes(file));
            if (unreviewed.length > 0 || unstagedSinceReview.length > 0) {
                throw new KnownError(
                    'The staged index changed since review; refusing to commit. Re-run aicommits to review the current staged changes.',
                );
            }

            // Commit exactly what was reviewed: an explicit pathspec with
            // --only instead of the bare full-index commit.
            const result = await this.git.commit(message, [...reviewedFiles], { '--only': null });

            // simple-git 4.0.2's CommitResult carries no committed file list;
            // read it straight from the produced commit for the disclosure.
            let files: string[] = [];
            try {
                files = (await this.git.raw(['show', '--pretty=format:', '--name-only', result.commit]))
                    .split('\n')
                    .filter(Boolean);
            } catch {
                files = [];
            }

            return { ...result, files };
        } catch (error) {
            if (error instanceof KnownError) {
                throw error;
            }
            throw new KnownError('Failed to commit changes');
        }
    }

    async assertGitRepo(): Promise<string> {
        try {
            const topLevel = await this.git.revparse(['--show-toplevel']);
            return topLevel.trim();
        } catch {
            throw new KnownError('The current directory must be a Git repository!');
        }
    }

    private excludeFromDiff(path: string): string {
        return `:(exclude)${path}`;
    }

    /**
     * @param exclude every pattern to leave out of the diff; the resolved profile's
     *   `exclude` already merges any persisted global ignore, profile, and CLI patterns.
     */
    async getStagedDiff(
        exclude: string[],
        contextLines: number,
    ): Promise<{ files: string[]; diff: string; filesExcludedFromReview?: string[] } | undefined> {
        const diffCached = ['--cached', '--diff-algorithm=minimal'] as const;
        const excludeArgs = exclude.map(this.excludeFromDiff);

        try {
            const stagedFiles = await this.git.diff([...diffCached, '--name-only']);
            const files = await this.git.diff([...diffCached, '--name-only', ...excludeArgs]);
            const reviewedFiles = files.split('\n').filter(Boolean);
            if (reviewedFiles.length === 0) {
                return;
            }

            const reviewed = new Set(reviewedFiles);
            const diff = await this.git.diff([`-U${contextLines}`, ...diffCached, ...excludeArgs]);

            return {
                files: reviewedFiles,
                diff,
                // Index files the exclusion pathspecs filtered out of the review
                // artifact; the handler must disclose these before committing.
                filesExcludedFromReview: stagedFiles
                    .split('\n')
                    .filter(Boolean)
                    .filter((file) => !reviewed.has(file)),
            };
        } catch {
            throw new KnownError('Failed to get staged diff');
        }
    }

    getDetectedMessage(files: unknown[]): string {
        return `Detected ${files.length.toLocaleString()} staged file${files.length > 1 ? 's' : ''}`;
    }

    async getRecentCommitMessages(count: number = 5): Promise<string[]> {
        try {
            const logs = await this.git.log({ maxCount: count, '--no-merges': null });
            return logs.all.map((commit) => commit.message).filter(Boolean);
        } catch {
            return [];
        }
    }
}
