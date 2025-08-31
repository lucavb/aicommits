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

    async getRecentCommitMessages(count: number = 5): Promise<string[]> {
        try {
            const log = await this.git.log(['--oneline', `-n${count}`, '--pretty=format:%s']);
            return log.all.map((commit) => commit.message).filter(Boolean);
        } catch {
            // If we can't get commit history (e.g., new repo), return empty array
            return [];
        }
    }
}
