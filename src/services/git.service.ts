import type { SimpleGit } from 'simple-git';
import simpleGit from 'simple-git';
import parseDiff from 'parse-diff';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

    async getWorkingDiff(contextLines: number): Promise<string | undefined> {
        const excludeArgs = [...this.filesToExclude] as const;

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

    async resetAllStaged(): Promise<void> {
        try {
            await this.git.reset(['HEAD']);
        } catch {
            throw new KnownError('Failed to reset staged files');
        }
    }

    async getStagedDiffForFiles(
        files: string[],
        contextLines: number = 3,
    ): Promise<{ files: string[]; diff: string } | undefined> {
        const diffCached = ['--cached', '--diff-algorithm=minimal'] as const;

        try {
            // Get the actual staged files to verify they exist
            const allStagedFiles = await this.git.diff([...diffCached, '--name-only']);
            if (!allStagedFiles) {
                return;
            }

            const allStagedFilesList = allStagedFiles.split('\n').filter(Boolean);
            const filteredFiles = files.filter((file) => allStagedFilesList.includes(file));

            if (filteredFiles.length === 0) {
                return;
            }

            // Get diff for specific files
            const diff = await this.git.diff([`-U${contextLines}`, ...diffCached, '--', ...filteredFiles]);

            return {
                files: filteredFiles,
                diff,
            };
        } catch {
            throw new KnownError('Failed to get staged diff for specific files');
        }
    }

    async hasStagedChanges(): Promise<boolean> {
        try {
            const staged = await this.git.diff(['--cached', '--name-only']);
            return Boolean(staged && staged.trim().length > 0);
        } catch {
            throw new KnownError('Failed to check for staged changes');
        }
    }

    /**
     * Get working directory changes as structured hunks using parse-diff library
     */
    async getWorkingChangesAsHunks(): Promise<
        {
            file: string;
            hunkId: string;
            summary: string;
            chunk: parseDiff.Chunk;
            linesAdded: number;
            linesRemoved: number;
            oldStart: number;
            newStart: number;
        }[]
    > {
        try {
            // Get the complete working directory diff
            const diff = await this.git.diff(['--no-prefix']);
            if (!diff) {
                return [];
            }

            // Parse the diff using the parse-diff library
            const parsedFiles = parseDiff(diff);

            const hunks: {
                file: string;
                hunkId: string;
                summary: string;
                chunk: parseDiff.Chunk;
                linesAdded: number;
                linesRemoved: number;
                oldStart: number;
                newStart: number;
            }[] = [];

            // Extract hunks from each file
            for (const file of parsedFiles) {
                const fileName = file.to || file.from || 'unknown';

                for (let chunkIndex = 0; chunkIndex < file.chunks.length; chunkIndex++) {
                    const chunk = file.chunks[chunkIndex];

                    // Count additions and deletions in this chunk
                    const additions = chunk.changes.filter((change) => change.type === 'add').length;
                    const deletions = chunk.changes.filter((change) => change.type === 'del').length;

                    // Create summary from the first few changed lines
                    const changedLines = chunk.changes
                        .filter((change) => change.type === 'add' || change.type === 'del')
                        .slice(0, 2)
                        .map((change) => change.content.trim())
                        .join(', ');

                    const summary =
                        changedLines.length > 50
                            ? changedLines.substring(0, 47) + '...'
                            : changedLines || 'Code changes';

                    hunks.push({
                        file: fileName,
                        hunkId: `${fileName}_chunk_${chunkIndex}`,
                        summary,
                        chunk,
                        linesAdded: additions,
                        linesRemoved: deletions,
                        oldStart: chunk.oldStart,
                        newStart: chunk.newStart,
                    });
                }
            }

            return hunks;
        } catch (error) {
            throw new KnownError(
                `Failed to get working changes as hunks: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    /**
     * Stage specific hunks using git's native patch application
     */
    async stageSelectedHunks(
        selectedHunks: {
            file: string;
            chunk: parseDiff.Chunk;
        }[],
    ): Promise<void> {
        try {
            // Reset staging area
            await this.resetAllStaged();

            // Group chunks by file
            const fileChunks = new Map<string, parseDiff.Chunk[]>();

            for (const { file, chunk } of selectedHunks) {
                if (!fileChunks.has(file)) {
                    fileChunks.set(file, []);
                }
                fileChunks.get(file)!.push(chunk);
            }

            // Apply patches for each file
            for (const [file, chunks] of fileChunks) {
                // Create a complete patch for this file
                const fullPatch = this.createFilePatchFromChunks(file, chunks);

                // Write patch to temporary file
                const tmpFile = join(tmpdir(), `aicommits-patch-${Date.now()}.patch`);
                writeFileSync(tmpFile, fullPatch, 'utf8');

                try {
                    // Apply using git apply --cached
                    await this.git.raw('apply', '--cached', tmpFile);
                } finally {
                    // Clean up temporary file
                    unlinkSync(tmpFile);
                }
            }
        } catch (error) {
            throw new KnownError(
                `Failed to stage selected hunks: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    private createFilePatchFromChunks(file: string, chunks: parseDiff.Chunk[]): string {
        let patch = `diff --git ${file} ${file}\n`;
        patch += 'index 0000000..1111111 100644\n';
        patch += `--- ${file}\n`;
        patch += `+++ ${file}\n`;

        for (const chunk of chunks) {
            // Create the hunk header
            const oldCount = chunk.oldLines;
            const newCount = chunk.newLines;
            patch += `@@ -${chunk.oldStart},${oldCount} +${chunk.newStart},${newCount} @@\n`;

            // Add all the changes in this chunk
            for (const change of chunk.changes) {
                switch (change.type) {
                    case 'add':
                        patch += `+${change.content}\n`;
                        break;
                    case 'del':
                        patch += `-${change.content}\n`;
                        break;
                    case 'normal':
                        patch += ` ${change.content}\n`;
                        break;
                }
            }
        }

        return patch;
    }
}
