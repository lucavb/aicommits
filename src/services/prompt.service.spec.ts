import { describe, it, expect } from 'vitest';
import { PromptService } from './prompt.service';

describe('PromptService', () => {
    const promptService = new PromptService();

    describe('getCommitMessageSystemPrompt', () => {
        it('should include instructions to focus only on actual changes', () => {
            const prompt = promptService.getCommitMessageSystemPrompt();

            expect(prompt).toContain('only consider the actual changes made');
            expect(prompt).toContain('lines starting with "+" for additions or "-" for deletions');
            expect(prompt).toContain('Ignore context lines and existing code');
        });
    });

    describe('generateSummaryPrompt', () => {
        it('should include specific instructions about focusing on added lines only', () => {
            const prompt = promptService.generateSummaryPrompt('en');

            expect(prompt).toContain('Only describe the changes that were ADDED');
            expect(prompt).toContain('Focus only on lines that start with "+"');
            expect(prompt).toContain('Do not describe existing code, context lines');
            expect(prompt).toContain('If a line does not start with "+", it was already there');
        });

        it('should set the correct language', () => {
            const prompt = promptService.generateSummaryPrompt('es');
            expect(prompt).toContain('Message language: es');
        });
    });

    describe('generateCommitMessagePrompt', () => {
        it('should include instructions to focus only on actual changes', () => {
            const prompt = promptService.generateCommitMessagePrompt('en', 50, '');

            expect(prompt).toContain('Base the commit message only on the actual changes made');
            expect(prompt).toContain('lines starting with "+" for additions or "-" for deletions');
            expect(prompt).toContain('Do not describe existing code, context lines');
        });

        it('should set the correct language and max length', () => {
            const prompt = promptService.generateCommitMessagePrompt('fr', 100, '');

            expect(prompt).toContain('Message language: fr');
            expect(prompt).toContain('maximum of 100 characters');
        });

        it('should include conventional commit format when specified', () => {
            const prompt = promptService.generateCommitMessagePrompt('en', 50, 'conventional');

            expect(prompt).toContain('Choose a type from the type-to-description JSON');
            expect(prompt).toContain('<type>(<optional scope>): <commit message>');
        });

        it('should use recent commits for style when 5 or more commits provided', () => {
            const recentCommits = [
                'feat: add new feature',
                'fix: resolve bug in component',
                'docs: update README',
                'refactor: improve code structure',
                'test: add unit tests',
            ];

            const prompt = promptService.generateCommitMessagePrompt('en', 50, 'conventional', recentCommits);

            expect(prompt).toContain('Match the style and format of the recent commit messages below');
            expect(prompt).toContain('Recent commit messages:');
            expect(prompt).toContain('1. feat: add new feature');
            expect(prompt).toContain('2. fix: resolve bug in component');
            expect(prompt).toContain('5. test: add unit tests');
            expect(prompt).toContain('Generate a commit message that follows the same style');

            // Should not contain conventional commit type instructions when using recent commits
            expect(prompt).not.toContain('Choose a type from the type-to-description JSON');
            expect(prompt).not.toContain('<type>(<optional scope>): <commit message>');
        });

        it('should fallback to type-based format when fewer than 5 recent commits', () => {
            const recentCommits = ['feat: add feature', 'fix: bug fix'];

            const prompt = promptService.generateCommitMessagePrompt('en', 50, 'conventional', recentCommits);

            // Should use conventional format since we have < 5 commits
            expect(prompt).toContain('Choose a type from the type-to-description JSON');
            expect(prompt).toContain('<type>(<optional scope>): <commit message>');
            expect(prompt).not.toContain('Recent commit messages:');
        });

        it('should fallback to type-based format when no recent commits provided', () => {
            const prompt = promptService.generateCommitMessagePrompt('en', 50, 'conventional', []);

            // Should use conventional format since we have no commits
            expect(prompt).toContain('Choose a type from the type-to-description JSON');
            expect(prompt).toContain('<type>(<optional scope>): <commit message>');
            expect(prompt).not.toContain('Recent commit messages:');
        });

        it('should fallback to type-based format when recent commits is undefined', () => {
            const prompt = promptService.generateCommitMessagePrompt('en', 50, 'conventional');

            // Should use conventional format since recentCommits is undefined
            expect(prompt).toContain('Choose a type from the type-to-description JSON');
            expect(prompt).toContain('<type>(<optional scope>): <commit message>');
            expect(prompt).not.toContain('Recent commit messages:');
        });
    });
});
