import type { SimpleGit } from 'simple-git';
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

    async commitChanges(message: string): Promise<void> {
        try {
            await this.git.commit(message);
        } catch {
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
     *   `exclude` already merges global ignore, profile, and CLI patterns.
     */
    async getStagedDiff(
        exclude: string[],
        contextLines: number,
    ): Promise<{ files: string[]; diff: string } | undefined> {
        const diffCached = ['--cached', '--diff-algorithm=minimal'] as const;
        const excludeArgs = exclude.map(this.excludeFromDiff);

        try {
            const files = await this.git.diff([...diffCached, '--name-only', ...excludeArgs]);
            if (!files) {
                return;
            }

            const diff = await this.git.diff([`-U${contextLines}`, ...diffCached, ...excludeArgs]);

            return {
                files: files.split('\n').filter(Boolean),
                diff,
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
