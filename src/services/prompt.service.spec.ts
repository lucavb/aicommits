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

    describe('getAgentCommitMessageUserPrompt', () => {
        it('should generate user prompt with max length', () => {
            const prompt = promptService.getAgentCommitMessageUserPrompt(50);
            expect(prompt).toContain('Maximum 50 characters');
            expect(prompt).toContain('execution protocol');
            expect(prompt).toContain('CRITICAL: Your commit message MUST match the examples exactly');
            expect(prompt).toContain('comprehensive bullet points');
        });
    });
});
