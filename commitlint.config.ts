import type { UserConfig } from '@commitlint/types';
import { RuleConfigSeverity } from '@commitlint/types';

const Configuration: UserConfig = {
    /*
     * Resolve and load @commitlint/config-conventional from node_modules.
     * Referenced packages must be installed
     */
    extends: ['@commitlint/config-conventional'],

    /*
     * Any rules defined here will override rules from @commitlint/config-conventional
     */
    rules: {
        // Disable subject case rule to allow flexibility with acronyms and proper nouns
        'subject-case': [RuleConfigSeverity.Disabled],
        // Ensure the subject is not empty
        'subject-empty': [RuleConfigSeverity.Error, 'never'],
        // Ensure the type is not empty
        'type-empty': [RuleConfigSeverity.Error, 'never'],
        'body-max-line-length': [RuleConfigSeverity.Disabled],
    },

    /*
     * Array of functions that return true if commitlint should ignore the given message.
     */
    ignores: [
        // Ignore merge commits
        (commit) => commit.includes('Merge'),
        // Ignore revert commits
        (commit) => commit.includes('Revert'),
        // Ignore release commits
        (commit) => /^v\d+\.\d+\.\d+/.test(commit),
    ],

    /*
     * Whether commitlint uses the default ignore rules
     */
    defaultIgnores: true,

    /*
     * Custom URL to show upon failure
     */
    helpUrl: 'https://github.com/conventional-changelog/commitlint/#what-is-commitlint',
};

export default Configuration;
