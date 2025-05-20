import 'reflect-metadata';
import { Container } from 'inversify';
import { AICommitMessageService } from './ai-commit-message.service';

import { PromptService } from './prompt.service';
import { ConfigService } from './config.service';
import { Injectable } from '../utils/inversify';
import { AIProviderSymbol } from './ai-provider.interface';
import { describe, it, expect, beforeEach, vi } from 'vitest';

@Injectable()
class MockConfigService implements Partial<ConfigService> {
    getConfig = vi.fn();
}

@Injectable()
class MockPromptService implements Partial<PromptService> {
    generateCommitMessagePrompt = vi.fn().mockReturnValue('generateCommitMessagePrompt');
    generateSummaryPrompt = vi.fn().mockReturnValue('generateSummaryPrompt');
    getCommitMessageSystemPrompt = vi
        .fn()
        .mockReturnValue(
            'You are a git commit message generator. Your task is to write clear, concise, and descriptive commit messages that follow best practices. Always use the imperative mood and focus on the intent and impact of the change. Do not include file names, code snippets, or unnecessary details. Never include explanations, commentary, or formatting outside the commit message itself.',
        );
}

@Injectable()
class MockAIProvider {
    generateCompletion = vi.fn();
    listModels = vi.fn();
}

describe('AICommitMessageService', () => {
    let configService: MockConfigService;
    let promptService: MockPromptService;
    let service: AICommitMessageService;
    let aiProvider: MockAIProvider;

    beforeEach(() => {
        const container = new Container({ defaultScope: 'Singleton' });
        container.bind(ConfigService).to(MockConfigService as unknown as typeof ConfigService);
        container.bind(PromptService).to(MockPromptService as unknown as typeof PromptService);
        container.bind(AIProviderSymbol).to(MockAIProvider);
        container.bind(AICommitMessageService).toSelf();

        configService = container.get<MockConfigService>(ConfigService as unknown as typeof MockConfigService);
        promptService = container.get<MockPromptService>(PromptService as unknown as typeof MockPromptService);
        service = container.get(AICommitMessageService);
        aiProvider = container.get(AIProviderSymbol);
    });

    it('can be composed', () => {
        expect(service).toBeTruthy();
    });

    it('should generate commit messages and bodies', async () => {
        const diff = 'some diff';
        const config = {
            generate: 2,
            locale: 'en',
            maxLength: 50,
            model: 'gpt-3.5-turbo',
            type: 'feat',
        };

        configService.getConfig.mockReturnValue(config);

        aiProvider.generateCompletion
            .mockResolvedValueOnce({
                choices: [{ message: { content: 'Commit message 1.' } }, { message: { content: 'Commit message 2.' } }],
            })
            .mockResolvedValueOnce({
                choices: [{ message: { content: 'Summary 1' } }, { message: { content: 'Summary 2' } }],
            });

        const result = await service.generateCommitMessage({ diff });

        expect(result).toEqual({
            commitMessages: ['Commit message 1', 'Commit message 2'],
            bodies: ['Summary 1', 'Summary 2'],
        });

        expect(configService.getConfig).toHaveBeenCalledTimes(1);
        expect(promptService.generateCommitMessagePrompt).toHaveBeenCalledWith('en', 50, 'feat');
        expect(promptService.generateSummaryPrompt).toHaveBeenCalledWith('en');
    });
});
