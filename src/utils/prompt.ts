import type { Config } from './config';

type CommitType = NonNullable<Config['type']>;

const commitTypeFormats: Record<CommitType, string> = {
    '': '<commit message>',
    conventional: '<type>(<optional scope>): <commit message>',
};
const specifyCommitFormat = (type: CommitType): string =>
    `The output response must be in format:\n${commitTypeFormats[type]}`;

const commitTypes: Record<CommitType, string> = {
    '': '',

    /**
     * References:
     * Commitlint:
     * https://github.com/conventional-changelog/commitlint/blob/18fbed7ea86ac0ec9d5449b4979b762ec4305a92/%40commitlint/config-conventional/index.js#L40-L100
     *
     * Conventional Changelog:
     * https://github.com/conventional-changelog/conventional-changelog/blob/d0e5d5926c8addba74bc962553dd8bcfba90e228/packages/conventional-changelog-conventionalcommits/writer-opts.js#L182-L193
     */
    conventional: `Choose a type from the type-to-description JSON below that best describes the git diff:\n${JSON.stringify(
        {
            build: 'Changes that affect the build system or external dependencies',
            chore: "Other changes that don't modify src or test files",
            ci: 'Changes to our CI configuration files and scripts',
            docs: 'Documentation only changes',
            feat: 'A new feature',
            fix: 'A bug fix',
            perf: 'A code change that improves performance',
            refactor: 'A code change that neither fixes a bug nor adds a feature',
            revert: 'Reverts a previous commit',
            style: 'Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)',
            test: 'Adding missing tests or correcting existing tests',
        },
        null,
        2,
    )}`,
};

export const generateSummaryPrompt = (locale: string) =>
    [
        'Generate a concise git commit body written in present tense for the following code diff with the given specifications below:',
        `Message language: ${locale}`,
        'Use bullet points for the items.',
        'Return only the bullet points using the ascii character "*". Your entire response will be passed directly into git commit.',
    ]
        .filter((entry) => !!entry)
        .join('\n');

export const generateCommitMessagePrompt = (locale: string, maxLength: number, type: CommitType) =>
    [
        'Generate a concise git commit message written in present tense for the following code diff with the given specifications below:',
        `Message language: ${locale}`,
        `Commit message must be a maximum of ${maxLength} characters.`,
        'Exclude anything unnecessary. Your entire response will be passed directly into git commit.',
        commitTypes[type],
        specifyCommitFormat(type),
    ]
        .filter((entry) => !!entry)
        .join('\n');
