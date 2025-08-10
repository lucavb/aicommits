import type { SimpleGit } from 'simple-git';
import simpleGit from 'simple-git';
import { Inject, Injectable, Optional } from '../utils/inversify';
import { KnownError } from '../utils/error';
import { ConfigService } from './config.service';

export const SIMPLE_GIT = Symbol.for('SIMPLE_GIT');

@Injectable()
export class GitService {
    private readonly defaultIgnorePatterns = [
        'package-lock.json',
        'pnpm-lock.yaml',
        '*.lock', // yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
    ];

    constructor(
        @Optional()
        @Inject(SIMPLE_GIT)
        private readonly git: SimpleGit = simpleGit(),
        private readonly configService: ConfigService,
    ) {}

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

    private async getFilesToExclude(): Promise<string[]> {
        await this.configService.readConfig();

        let globalIgnore = this.configService.getGlobalIgnorePatterns();

        // Migration: if globalIgnore is not configured, initialize it with defaults
        if (globalIgnore.length === 0) {
            console.log('ℹ️  Global ignore patterns not configured. Adding default patterns to config...');
            globalIgnore = this.defaultIgnorePatterns;
            this.configService.setGlobalIgnorePatterns(globalIgnore);
            await this.configService.flush();
            console.log('✅ Default ignore patterns added to globalIgnore config');
        }

        return globalIgnore.map(this.excludeFromDiff);
    }

    async getStagedDiff(
        excludeFiles: string[] = [],
        contextLines: number,
    ): Promise<{ files: string[]; diff: string } | undefined> {
        const diffCached = ['--cached', '--diff-algorithm=minimal'] as const;
        const filesToExclude = await this.getFilesToExclude();
        const excludeArgs = [...filesToExclude, ...excludeFiles.map(this.excludeFromDiff)] as const;

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

    async getWorkingDiff(contextLines: number): Promise<string | undefined> {
        const filesToExclude = await this.getFilesToExclude();
        const excludeArgs = [...filesToExclude] as const;

        try {
            const diff = await this.git.diff([`-U${contextLines}`, ...excludeArgs]);
            return diff || undefined;
        } catch {
            throw new KnownError('Failed to get working directory diff');
        }
    }

    async stageFiles(files: string[]): Promise<void> {
        try {
            await this.git.add(files);
        } catch {
            throw new KnownError('Failed to stage files');
        }
    }

    async unstageFiles(files: string[]): Promise<void> {
        try {
            await this.git.reset(['HEAD', ...files]);
        } catch {
            throw new KnownError('Failed to unstage files');
        }
    }

    async getCommitHistory(count: number): Promise<string> {
        try {
            const log = await this.git.log({ maxCount: count });
            return log.all
                .map((commit) => `${commit.hash.substring(0, 7)} - ${commit.message} (${commit.author_name})`)
                .join('\n');
        } catch {
            throw new KnownError('Failed to get commit history');
        }
    }

    async getStatus(): Promise<string> {
        try {
            const status = await this.git.status();
            const result: string[] = [];

            if (status.staged.length > 0) {
                result.push(`Staged files (${status.staged.length}):`);
                status.staged.forEach((file) => result.push(`  ${file}`));
            }

            if (status.modified.length > 0) {
                result.push(`Modified files (${status.modified.length}):`);
                status.modified.forEach((file) => result.push(`  ${file}`));
            }

            if (status.not_added.length > 0) {
                result.push(`Untracked files (${status.not_added.length}):`);
                status.not_added.forEach((file) => result.push(`  ${file}`));
            }

            if (result.length === 0) {
                return 'Working tree clean';
            }

            return result.join('\n');
        } catch {
            throw new KnownError('Failed to get git status');
        }
    }
}
