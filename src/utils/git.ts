import simpleGit from 'simple-git';
import { KnownError } from './error';

const git = simpleGit();

export const stageAllFiles = async (): Promise<void> => {
    try {
        await git.add('.');
    } catch (error) {
        throw new Error('Failed to stage all files');
    }
};

export const commitChanges = async (message: string) => {
    try {
        await git.commit(message);
    } catch (error) {
        throw new KnownError('Failed to commit changes');
    }
};

export const assertGitRepo = async () => {
    try {
        const topLevel = await git.revparse(['--show-toplevel']);
        return topLevel.trim();
    } catch (error) {
        throw new KnownError('The current directory must be a Git repository!');
    }
};

const excludeFromDiff = (path: string) => `:(exclude)${path}`;

const filesToExclude = [
    'package-lock.json',
    'pnpm-lock.yaml',
    '*.lock', // yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
].map(excludeFromDiff);

export const getStagedDiff = async (excludeFiles: string[] = []) => {
    const diffCached = ['--cached', '--diff-algorithm=minimal'];
    const excludeArgs = [...filesToExclude, ...excludeFiles.map(excludeFromDiff)];

    try {
        const files = await git.diff([...diffCached, '--name-only', ...excludeArgs]);
        if (!files) {
            return;
        }

        const diff = await git.diff([...diffCached, ...excludeArgs]);

        return {
            files: files.split('\n').filter(Boolean),
            diff,
        };
    } catch (error) {
        throw new KnownError('Failed to get staged diff');
    }
};

export const getDetectedMessage = (files: unknown[]) =>
    `Detected ${files.length.toLocaleString()} staged file${files.length > 1 ? 's' : ''}`;
