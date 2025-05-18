import type { ProfileConfig } from '../utils/config';
import { Injectable } from '../utils/inversify';

type CommitType = NonNullable<ProfileConfig['type']>;

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

@Injectable()
export class PromptService {
    getCommitMessageSystemPrompt() {
        return [
            'You are a git commit message generator.',
            'Your task is to write clear, concise, and descriptive commit messages that follow best practices.',
            'Always use the imperative mood and focus on the intent and impact of the change.',
            'Do not include file names, code snippets, or unnecessary details.',
            'Never include explanations, commentary, or formatting outside the commit message itself.',
        ].join(' ');
    }

    generateSummaryPrompt(locale: string) {
        return [
            'Generate a concise git commit body written in present tense for the following code diff with the given specifications below:',
            `Message language: ${locale}`,
            'Use bullet points for the items.',
            'Return only the bullet points using the ascii character "*". Your entire response will be passed directly into git commit.',
        ]
            .filter((entry) => !!entry)
            .join('\n');
    }

    generateCommitMessagePrompt(locale: string, maxLength: number, type: CommitType) {
        return [
            `Message language: ${locale}`,
            `Commit message must be a maximum of ${maxLength} characters.`,
            'Write a clear, concise, and descriptive commit message in the imperative mood (e.g., "Add feature", "Fix bug").',
            'Focus on the main intent and impact of the change. If possible, briefly mention the reason or motivation.',
            'Do not include file names, code snippets, or restate the diff. Do not include unnecessary words or phrases.',
            'Avoid generic messages like "update code" or "fix issue".',
            'Return only the commit message, with no extra commentary or formatting.',
            commitTypes[type],
            specifyCommitFormat(type),
        ]
            .filter((entry) => !!entry)
            .join('\n');
    }
}
