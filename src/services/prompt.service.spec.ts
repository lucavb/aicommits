import { describe, it, expect, beforeEach } from 'vitest';
import { PromptService } from './prompt.service';

describe('PromptService', () => {
    let promptService: PromptService;

    beforeEach(() => {
        promptService = new PromptService();
    });

    describe('getAgentCommitMessageSystemPrompt', () => {
        it('should return system prompt for commit message generation', () => {
            const prompt = promptService.getAgentCommitMessageSystemPrompt();
            expect(prompt).toContain('# Agent Profile');
            expect(prompt).toContain('Git Commit Message Specialist Agent');
            expect(prompt).toContain('# Planning Module');
            expect(prompt).toContain('# Available Tools');
            expect(prompt).toContain('# Execution Protocol');
            expect(prompt).toContain('# CRITICAL: Example Matching Requirements');
            expect(prompt).toContain("MUST be indistinguishable from the repository's existing commit messages");
            expect(prompt).toContain('FAILURE TO MATCH EXAMPLES EXACTLY = TASK FAILURE');
            expect(prompt).toContain('finishCommitMessage()');
        });
    });

    describe('getAgentCommitMessageWithInstructionsSystemPrompt', () => {
        it('should return system prompt with user instructions for reprompting', () => {
            const userInstructions = 'Make it more descriptive and use conventional commits format';
            const prompt = promptService.getAgentCommitMessageWithInstructionsSystemPrompt(userInstructions);

            expect(prompt).toContain('# Agent Profile');
            expect(prompt).toContain('Git Commit Message Specialist Agent');
            expect(prompt).toContain('# ADDITIONAL USER INSTRUCTIONS');
            expect(prompt).toContain(userInstructions);
            expect(prompt).toContain('You MUST incorporate these user instructions');
            expect(prompt).toContain("perfect adherence to the repository's established format");
            expect(prompt).toContain('FAILURE TO MATCH EXAMPLES EXACTLY = TASK FAILURE');
            expect(prompt).toContain('finishCommitMessage()');
        });
    });

    describe('getAgentCommitMessageUserPrompt', () => {
        it('should generate user prompt with max length', () => {
            const prompt = promptService.getAgentCommitMessageUserPrompt(50);
            expect(prompt).toContain('Maximum 50 characters');
            expect(prompt).toContain('execution protocol');
            expect(prompt).toContain('CRITICAL: Your commit message MUST match the examples exactly');
            expect(prompt).toContain('comprehensive bullet points');
        });
    });

    describe('getAgentCommitMessageWithInstructionsUserPrompt', () => {
        it('should generate user prompt with max length and user instructions', () => {
            const userInstructions = 'Focus on performance improvements';
            const prompt = promptService.getAgentCommitMessageWithInstructionsUserPrompt(75, userInstructions);

            expect(prompt).toContain('Maximum 75 characters');
            expect(prompt).toContain('execution protocol');
            expect(prompt).toContain('CRITICAL: Your commit message MUST match the examples exactly');
            expect(prompt).toContain('IMPORTANT: The user has provided these specific instructions');
            expect(prompt).toContain(userInstructions);
            expect(prompt).toContain('incorporate these instructions while maintaining perfect adherence');
            expect(prompt).toContain('comprehensive bullet points');
        });
    });
});
