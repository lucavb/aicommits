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

    private filesToExclude: string[] = [
        'package-lock.json',
        'pnpm-lock.yaml',
        '*.lock', // yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
    ].map(this.excludeFromDiff);

    async getStagedDiff(
        excludeFiles: string[] = [],
        contextLines: number,
    ): Promise<{ files: string[]; diff: string } | undefined> {
        const diffCached = ['--cached', '--diff-algorithm=minimal'] as const;
        const excludeArgs = [...this.filesToExclude, ...excludeFiles.map(this.excludeFromDiff)] as const;

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

    async getStagedFileContent(filePath: string): Promise<string> {
        try {
            const content = await this.git.show([`${filePath}`]);
            return content;
        } catch {
            throw new KnownError(`Failed to get staged content for file: ${filePath}`);
        }
    }

    async getStagedFileLines(filePath: string, startLine: number = 1, lineCount?: number): Promise<string> {
        try {
            const content = await this.git.show([`${filePath}`]);
            const lines = content.split('\n');

            // Convert to 0-based indexing
            const startIndex = Math.max(0, startLine - 1);
            const endIndex = lineCount ? Math.min(lines.length, startIndex + lineCount) : lines.length;

            // Validate start line
            if (startIndex >= lines.length) {
                throw new Error(`Start line ${startLine} is beyond the file length (${lines.length} lines)`);
            }

            const selectedLines = lines.slice(startIndex, endIndex);
            return selectedLines.join('\n');
        } catch (error) {
            throw new KnownError(
                `Failed to get staged content for file: ${filePath} - ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    async getStagedFileNames(excludeFiles: string[] = []): Promise<string[]> {
        const diffCached = ['--cached', '--diff-algorithm=minimal'] as const;
        const excludeArgs = [...this.filesToExclude, ...excludeFiles.map(this.excludeFromDiff)] as const;

        try {
            const files = await this.git.diff([...diffCached, '--name-only', ...excludeArgs]);
            if (!files) {
                return [];
            }

            return files.split('\n').filter(Boolean);
        } catch {
            throw new KnownError('Failed to get staged file names');
        }
    }

    async getStagedFileDiff(filePath: string, contextLines: number = 3): Promise<string> {
        try {
            const diff = await this.git.diff([`-U${contextLines}`, '--cached', filePath]);
            return diff;
        } catch {
            throw new KnownError(`Failed to get diff for staged file: ${filePath}`);
        }
    }

    async getRecentCommitHistory(maxCount: number = 10): Promise<
        {
            hash: string;
            message: string;
            author: string;
            date: string;
        }[]
    > {
        try {
            const log = await this.git.log({ maxCount });

            return log.all.map((commit) => ({
                hash: commit.hash.substring(0, 8),
                message: commit.message,
                author: commit.author_name,
                date: commit.date,
            }));
        } catch {
            throw new KnownError('Failed to get commit history');
        }
    }

    async getRecentCommitMessages(maxCount: number = 5): Promise<string[]> {
        try {
            const log = await this.git.log({ maxCount });

            return log.all.map((commit) => commit.message);
        } catch {
            throw new KnownError('Failed to get commit messages');
        }
    }

    async getGitStatus(): Promise<{
        staged: string[];
        modified: string[];
        untracked: string[];
        deleted: string[];
    }> {
        try {
            const status = await this.git.status();

            return {
                staged: status.staged,
                modified: status.modified,
                untracked: status.not_added,
                deleted: status.deleted,
            };
        } catch {
            throw new KnownError('Failed to get git status');
        }
    }

    async showCommit(commitHash: string = 'HEAD'): Promise<{
        hash: string;
        message: string;
        author: string;
        date: string;
        diff: string;
    }> {
        try {
            const commit = await this.git.show([commitHash, '--pretty=format:%H|%s|%an|%ad', '--date=relative']);
            const lines = commit.split('\n');
            const headerLine = lines[0];
            const [hash, message, author, date] = headerLine.split('|');

            // Find where the diff starts (after the commit info)
            const diffStartIndex = lines.findIndex((line) => line.startsWith('diff --git'));
            const diff = diffStartIndex >= 0 ? lines.slice(diffStartIndex).join('\n') : '';

            return {
                hash: hash.substring(0, 8),
                message: message || 'No message',
                author: author || 'Unknown',
                date: date || 'Unknown',
                diff,
            };
        } catch {
            throw new KnownError(`Failed to show commit: ${commitHash}`);
        }
    }

    async getFileBlame(
        filePath: string,
        maxLines: number = 50,
    ): Promise<
        {
            line: number;
            hash: string;
            author: string;
            date: string;
            content: string;
        }[]
    > {
        try {
            const blame = await this.git.raw(['blame', '--line-porcelain', filePath]);
            const lines = blame.split('\n');
            const result = [];

            let currentCommit = '';
            let currentAuthor = '';
            let currentDate = '';
            let lineNumber = 1;

            for (let i = 0; i < lines.length && result.length < maxLines; i++) {
                const line = lines[i];

                if (line.match(/^[a-f0-9]{40}/)) {
                    currentCommit = line.substring(0, 8);
                } else if (line.startsWith('author ')) {
                    currentAuthor = line.substring(7);
                } else if (line.startsWith('author-time ')) {
                    const timestamp = parseInt(line.substring(12));
                    currentDate = new Date(timestamp * 1000).toLocaleDateString();
                } else if (line.startsWith('\t')) {
                    result.push({
                        line: lineNumber++,
                        hash: currentCommit,
                        author: currentAuthor,
                        date: currentDate,
                        content: line.substring(1),
                    });
                }
            }

            return result;
        } catch {
            throw new KnownError(`Failed to get blame for file: ${filePath}`);
        }
    }

    async getBranchInfo(): Promise<{
        currentBranch: string;
        remoteBranch?: string;
        ahead: number;
        behind: number;
    }> {
        try {
            const status = await this.git.status();
            const currentBranch = status.current || 'Unknown';

            // Get tracking info
            let ahead = 0;
            let behind = 0;
            let remoteBranch: string | undefined;

            try {
                const branchInfo = await this.git.raw(['status', '--porcelain=v2', '--branch']);
                const branchLine = branchInfo.split('\n').find((line) => line.startsWith('# branch.upstream'));
                if (branchLine) {
                    remoteBranch = branchLine.split(' ')[2];
                }

                const aheadLine = branchInfo.split('\n').find((line) => line.startsWith('# branch.ahead'));
                if (aheadLine) {
                    ahead = parseInt(aheadLine.split(' ')[2]) || 0;
                }

                const behindLine = branchInfo.split('\n').find((line) => line.startsWith('# branch.behind'));
                if (behindLine) {
                    behind = parseInt(behindLine.split(' ')[2]) || 0;
                }
            } catch {
                // Ignore errors getting tracking info
            }

            return {
                currentBranch,
                remoteBranch,
                ahead,
                behind,
            };
        } catch {
            throw new KnownError('Failed to get branch info');
        }
    }

    async getCommitMessageStyleExamples(count: number = 5): Promise<
        {
            hash: string;
            message: string;
            author: string;
            date: string;
        }[]
    > {
        try {
            // Get more commits than needed to filter out merges and reverts
            const log = await this.git.log({
                maxCount: count * 3,
                format: {
                    hash: '%H',
                    message: '%s',
                    author_name: '%an',
                    date: '%ad',
                },
            });

            const filteredCommits = log.all
                .map((commit) => ({
                    hash: commit.hash.substring(0, 8),
                    message: commit.message,
                    author: commit.author_name,
                    date: commit.date,
                }))
                .filter((commit) => {
                    const message = commit.message.toLowerCase();
                    // Filter out revert commits
                    return (
                        !message.startsWith('revert') &&
                        !message.includes('revert:') &&
                        !message.startsWith('merge') &&
                        commit.message.trim().length > 0
                    );
                })
                .slice(0, count); // Take only the requested number

            return filteredCommits;
        } catch {
            throw new KnownError('Failed to get commit message style examples');
        }
    }
}
