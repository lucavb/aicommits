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
    createAgentSystemPrompt(): string {
        return [
            'You are an AI agent that helps generate git commit messages by autonomously analyzing a git repository.',
            'You have access to tools that allow you to:',
            '- Check git status and see what files are staged/modified',
            '- View diffs of changes',
            '- List files in the repository',
            '- Read file contents',
            '- View recent commit history',
            '- Stage/unstage files as needed',
            '- Finish with a commit message when ready',
            '',
            'Your goal is to:',
            '1. Analyze the current state of the repository',
            '2. Understand what changes have been made',
            '3. Generate a meaningful commit message and body',
            '',
            'IMPORTANT GUIDELINES:',
            '- Use the tools to explore and understand the changes before generating the commit message',
            '- Focus on the actual changes made (lines with + or - in diffs)',
            '- Generate commit messages that follow best practices',
            '- Use imperative mood (e.g., "Add feature", "Fix bug")',
            '- Be specific about what was changed and why',
            '- If no files are staged, you may suggest staging relevant files first',
            '',
            'CRITICAL: When you are ready to provide the final commit message, you MUST call the "finishCommit" tool with your commit message and optional body.',
            'Do not include the commit message in your regular text response - only use the finishCommit tool for the final result.',
        ].join('\n');
    }

    createAgentUserPrompt(): string {
        return [
            'Please analyze the current git repository and generate an appropriate commit message.',
            '',
            'Start by:',
            '1. Checking the current git status and examining any changes',
            '2. Looking at recent commit history to understand the typical patterns:',
            '   - Message length and format',
            '   - Language and style',
            '   - Commit type conventions (conventional commits, etc.)',
            '   - Overall patterns and preferences',
            '',
            "Use the available tools to understand what has been modified and the repository's commit style.",
            'Generate a commit message that matches the established patterns in this repository.',
            'Then call the finishCommit tool with your final commit message and optional body.',
        ].join('\n');
    }

    createAgentRevisionPrompt(currentMessage: string, currentBody: string, userRevisionPrompt: string): string {
        return [
            'I need you to revise a commit message based on user feedback.',
            '',
            'CURRENT COMMIT MESSAGE:',
            currentMessage,
            '',
            'CURRENT COMMIT BODY:',
            currentBody || '(empty)',
            '',
            'USER REVISION REQUEST:',
            userRevisionPrompt,
            '',
            "Please use your tools to re-examine the repository and generate a revised commit message that addresses the user's feedback.",
            '',
            'Use the git tools to:',
            '- Re-examine the staged changes',
            '- Look at additional context in the repository',
            '- Check commit history for patterns and typical style',
            '- Understand the broader impact of the changes',
            '',
            'Ensure your revised message matches the established style, language, format, and conventions from the commit history.',
            'Then call the finishCommit tool with your revised commit message and optional body.',
        ].join('\n');
    }

    getCommitMessageSystemPrompt() {
        return [
            'You are a git commit message generator.',
            'Your task is to write clear, concise, and descriptive commit messages that follow best practices.',
            'Always use the imperative mood and focus on the intent and impact of the change.',
            'CRITICAL: When analyzing a git diff, only consider the actual changes made (lines starting with "+" for additions or "-" for deletions).',
            'Ignore context lines and existing code that appears in the diff without "+" or "-" prefixes.',
            'Do not include file names, code snippets, or unnecessary details.',
            'Never include explanations, commentary, or formatting outside the commit message itself.',
        ].join(' ');
    }

    generateSummaryPrompt(locale: string) {
        return [
            'Generate a concise git commit body written in present tense for the following code diff with the given specifications below:',
            `Message language: ${locale}`,
            'IMPORTANT: Only describe the changes that were ADDED in this diff. Focus only on lines that start with "+" (plus sign).',
            'Do not describe existing code, context lines, or unchanged code that appears in the diff.',
            'If a line does not start with "+", it was already there and should not be mentioned in the commit body.',
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
            'IMPORTANT: Base the commit message only on the actual changes made (lines starting with "+" for additions or "-" for deletions).',
            'Do not describe existing code, context lines, or unchanged code that appears in the diff.',
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
