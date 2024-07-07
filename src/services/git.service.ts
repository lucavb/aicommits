import type { SimpleGit } from 'simple-git';
import simpleGit from 'simple-git';
import { Inject, Injectable, Optional } from '../utils/inversify';
import { KnownError } from '../utils/error';

export const SIMPLE_GIT = Symbol.for('SIMPLE_GIT');

@Injectable()
export class GitService {
    constructor(
        @Optional()
        @Inject(SIMPLE_GIT)
        private readonly git: SimpleGit = simpleGit(),
    ) {}

    async stageAllFiles(): Promise<void> {
        try {
            await this.git.add('.');
        } catch (error) {
            throw new Error('Failed to stage all files');
        }
    }

    async commitChanges(message: string): Promise<void> {
        try {
            await this.git.commit(message);
        } catch (error) {
            throw new KnownError('Failed to commit changes');
        }
    }

    async assertGitRepo(): Promise<string> {
        try {
            const topLevel = await this.git.revparse(['--show-toplevel']);
            return topLevel.trim();
        } catch (error) {
            throw new KnownError('The current directory must be a Git repository!');
        }
    }

    private excludeFromDiff(path: string): string {
        return `:(exclude)${path}`;
    }

    private filesToExclude: string[] = [
        'package-lock.json',
        'pnpm-lock.yaml',
        '*.lock', // yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
    ].map(this.excludeFromDiff);

    async getStagedDiff(
        excludeFiles: string[] = [],
        contextLines: number,
    ): Promise<{ files: string[]; diff: string } | undefined> {
        const diffCached = ['--cached', '--diff-algorithm=minimal'];
        const excludeArgs = [...this.filesToExclude, ...excludeFiles.map(this.excludeFromDiff)];

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
        } catch (error) {
            throw new KnownError('Failed to get staged diff');
        }
    }

    getDetectedMessage(files: unknown[]): string {
        return `Detected ${files.length.toLocaleString()} staged file${files.length > 1 ? 's' : ''}`;
    }
}
