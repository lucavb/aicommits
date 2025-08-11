import { describe, expect, it } from 'vitest';
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
    });
});
