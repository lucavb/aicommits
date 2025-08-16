import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from '@commander-js/extra-typings';
import { agentCommand } from '../agent';

describe('Agent Command Integration', () => {
    let mockConsoleLog: ReturnType<typeof vi.spyOn>;
    let mockProcessExit: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit called');
        });
    });

    it('should have pr subcommand registered', () => {
        const commands = agentCommand.commands;
        const prCommand = commands.find(cmd => cmd.name() === 'pr');
        
        expect(prCommand).toBeDefined();
        expect(prCommand?.description()).toBe('Create a GitHub Pull Request with AI-generated content');
    });

    it('should have correct options for pr subcommand', () => {
        const commands = agentCommand.commands;
        const prCommand = commands.find(cmd => cmd.name() === 'pr');
        
        expect(prCommand).toBeDefined();
        
        const options = prCommand?.options || [];
        const optionNames = options.map(opt => opt.long);
        
        expect(optionNames).toContain('--base');
        expect(optionNames).toContain('--head');
        expect(optionNames).toContain('--draft');
    });

    it('should parse pr command options correctly', () => {
        const commands = agentCommand.commands;
        const prCommand = commands.find(cmd => cmd.name() === 'pr');
        
        expect(prCommand).toBeDefined();
        
        // Test option configurations
        const baseOption = prCommand?.options.find(opt => opt.long === '--base');
        const headOption = prCommand?.options.find(opt => opt.long === '--head');
        const draftOption = prCommand?.options.find(opt => opt.long === '--draft');
        
        expect(baseOption?.description).toBe('Base branch for the PR (defaults to main/master)');
        expect(headOption?.description).toBe('Head branch for the PR (defaults to current branch)');
        expect(draftOption?.description).toBe('Create a draft PR');
        expect(draftOption?.defaultValue).toBe(false);
    });

    it('should have agent command with correct structure', () => {
        expect(agentCommand.name()).toBe('agent');
        expect(agentCommand.description()).toBe('Enable AI agent mode for autonomous repository analysis');
        
        const options = agentCommand.options;
        const optionNames = options.map(opt => opt.long);
        
        expect(optionNames).toContain('--profile');
        expect(optionNames).toContain('--split');
        expect(optionNames).toContain('--stage-all');
    });

    it('should have pr subcommand properly configured', async () => {
        const commands = agentCommand.commands;
        const prCommand = commands.find(cmd => cmd.name() === 'pr');
        
        expect(prCommand).toBeDefined();
        expect(prCommand?.name()).toBe('pr');
        expect(prCommand?.description()).toBe('Create a GitHub Pull Request with AI-generated content');
        
        // Verify the command has an action handler
        expect(prCommand?._actionHandler).toBeDefined();
    });
});