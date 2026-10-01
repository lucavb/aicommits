import type { CommitResult, SimpleGit } from 'simple-git';
import { Inject, Injectable } from '../utils/inversify';
import { KnownError } from '../utils/error';
import { ConfigService } from './config.service';

export const SIMPLE_GIT = Symbol.for('SIMPLE_GIT');

export type GetStagedDiffOptions = {
    // Callback used to obtain the user's explicit consent before the tool
    // initializes and persists its default ignore patterns on first run.
    // When absent, or when it resolves to false, the tool-authored defaults
    // are neither applied nor persisted.
    requestDefaultIgnoreConsent?: () => Promise<boolean>;
};

@Injectable()
export class GitService {
    private readonly defaultIgnorePatterns = [
        'package-lock.json',
        'pnpm-lock.yaml',
        '*.lock', // yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
    ];

    constructor(
        @Inject(SIMPLE_GIT) private readonly git: SimpleGit,
        @Inject(ConfigService) private readonly configService: ConfigService,
    ) {}

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

    private async getFilesToExclude(requestDefaultIgnoreConsent?: () => Promise<boolean>): Promise<string[]> {
        await this.configService.readConfig();

        const globalIgnore = this.configService.getGlobalIgnorePatterns();
        if (globalIgnore.length > 0) {
            return globalIgnore.map(this.excludeFromDiff);
        }

        // First run: the tool must never silently initialize and persist its
        // default ignore patterns. Apply and persist them only after the user
        // explicitly consented; otherwise show every staged file for review.
        const consented = (await requestDefaultIgnoreConsent?.()) ?? false;
        if (!consented) {
            console.log(
                'ℹ️  Global ignore patterns not configured. Tool default excludes were NOT applied; every staged file is shown for review.',
            );
            return [];
        }

        this.configService.setGlobalIgnorePatterns(this.defaultIgnorePatterns);
        await this.configService.flush();
        console.log('✅ Default ignore patterns added to globalIgnore config');
        return this.defaultIgnorePatterns.map(this.excludeFromDiff);
    }

    async getStagedDiff(
        excludeFiles: string[] = [],
        contextLines: number,
        options: GetStagedDiffOptions = {},
    ): Promise<{ files: string[]; diff: string; filesExcludedFromReview?: string[] } | undefined> {
        const diffCached = ['--cached', '--diff-algorithm=minimal'] as const;
        const filesToExclude = await this.getFilesToExclude(options.requestDefaultIgnoreConsent);
        const excludeArgs = [...filesToExclude, ...excludeFiles.map(this.excludeFromDiff)] as const;

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
