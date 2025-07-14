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
            expect(prompt).toContain('# Agent Identity');
            expect(prompt).toContain('Git Commit Message Specialist Agent');
            expect(prompt).toContain('# Behavioral Guidelines');
            expect(prompt).toContain('# Available Tools');
            expect(prompt).toContain('# Critical Style Matching Rule');
            expect(prompt).toContain('# Response Requirements');
            expect(prompt).toContain("MUST be indistinguishable from the repository's existing commit messages");
            expect(prompt).toContain('Study the examples carefully and replicate the format, tone, and style exactly');
            expect(prompt).toContain('finishCommitMessage()');
            expect(prompt).toContain('imperative mood');
            expect(prompt).toContain('NEVER terminate until successfully calling finishCommitMessage()');
            expect(prompt).toContain('NEVER provide generic responses or ask for clarification');
            expect(prompt).toContain('ALWAYS follow the complete execution protocol without shortcuts');
            expect(prompt).toContain('ALWAYS end by calling finishCommitMessage() - no exceptions');
        });
    });

    describe('getAgentCommitMessageWithInstructionsSystemPrompt', () => {
        it('should return system prompt with user instructions for reprompting', () => {
            const userInstructions = 'Make it more descriptive and use conventional commits format';
            const prompt = promptService.getAgentCommitMessageWithInstructionsSystemPrompt(userInstructions);

            expect(prompt).toContain('# Agent Identity');
            expect(prompt).toContain('Git Commit Message Specialist Agent');
            expect(prompt).toContain('# Additional User Instructions');
            expect(prompt).toContain(userInstructions);
            expect(prompt).toContain('You MUST incorporate these user instructions');
            expect(prompt).toContain("perfect adherence to the repository's established format");
            expect(prompt).toContain('finishCommitMessage()');
            expect(prompt).toContain('# Behavioral Guidelines');
            expect(prompt).toContain('# Critical Style Matching Rule');
            expect(prompt).toContain('# Response Requirements');
            expect(prompt).toContain('NEVER provide generic responses or ask for clarification');
            expect(prompt).toContain('ALWAYS end by calling finishCommitMessage() - no exceptions');
        });
    });

    describe('getAgentCommitMessageUserPrompt', () => {
        it('should generate user prompt with max length and visual separators', () => {
            const prompt = promptService.getAgentCommitMessageUserPrompt(50);
            expect(prompt).toContain('# Task: Generate Commit Message for Staged Changes');
            expect(prompt).toContain('## Execution Protocol');
            expect(prompt).toContain('🚨 MANDATORY: Execute this workflow systematically without skipping any steps:');
            expect(prompt).toContain('Maximum 50 characters total');
            expect(prompt).toContain('## Critical Requirements');
            expect(prompt).toContain('🚨 MANDATORY: Your commit message MUST match the repository\'s existing style exactly');
            expect(prompt).toContain('comprehensive bullet points');
            expect(prompt).toContain('-----');
            expect(prompt).toContain('BEGIN EXECUTION');
            expect(prompt).toContain('🚨 FAILURE TO MATCH EXAMPLES EXACTLY = TASK FAILURE');
            expect(prompt).toContain('🚨 FAILURE TO CALL finishCommitMessage() = TASK FAILURE');
            expect(prompt).toContain('You MUST begin execution now by calling listStagedFiles(). DO NOT provide any other response.');
        });
    });

    describe('getAgentCommitMessageWithInstructionsUserPrompt', () => {
        it('should generate user prompt with max length, user instructions, and visual separators', () => {
            const userInstructions = 'Focus on performance improvements';
            const prompt = promptService.getAgentCommitMessageWithInstructionsUserPrompt(75, userInstructions);

            expect(prompt).toContain('# Task: Generate Commit Message for Staged Changes');
            expect(prompt).toContain('## Execution Protocol');
            expect(prompt).toContain('🚨 MANDATORY: Execute this workflow systematically without skipping any steps:');
            expect(prompt).toContain('Maximum 75 characters total');
            expect(prompt).toContain('## User Instructions');
            expect(prompt).toContain('IMPORTANT: The user has provided these specific instructions');
            expect(prompt).toContain(userInstructions);
            expect(prompt).toContain('incorporate these instructions while maintaining perfect adherence');
            expect(prompt).toContain('comprehensive bullet points');
            expect(prompt).toContain('-----');
            expect(prompt).toContain('USER-SPECIFIC INSTRUCTIONS');
            expect(prompt).toContain('END USER INSTRUCTIONS');
            expect(prompt).toContain('BEGIN EXECUTION');
            expect(prompt).toContain('🚨 FAILURE TO MATCH EXAMPLES EXACTLY = TASK FAILURE');
            expect(prompt).toContain('🚨 FAILURE TO CALL finishCommitMessage() = TASK FAILURE');
            expect(prompt).toContain('You MUST begin execution now by calling listStagedFiles(). DO NOT provide any other response.');
        });
    });
});
