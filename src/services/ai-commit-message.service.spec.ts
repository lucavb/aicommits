import 'reflect-metadata';
import { Container } from 'inversify';
import OpenAI from 'openai';
import { AICommitMessageService } from './ai-commit-message.service';

import { PromptService } from './prompt.service';
import { ConfigService } from './config.service';
import { Injectable } from '../utils/inversify';

type DeepPartial<T> = T extends object
    ? {
          [P in keyof T]?: DeepPartial<T[P]>;
      }
    : T;

@Injectable()
class MockOpenAI implements DeepPartial<OpenAI> {
    public readonly chat = {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        completions: {
            create: jest.fn().mockResolvedValue({}),
        } as const,
    } as const satisfies Partial<OpenAI['chat']>;
}

@Injectable()
class MockConfigService implements Partial<ConfigService> {
    getConfig = jest.fn();
}

@Injectable()
class MockPromptService implements Partial<PromptService> {
    generateCommitMessagePrompt = jest.fn().mockReturnValue('generateCommitMessagePrompt');
    generateSummaryPrompt = jest.fn().mockReturnValue('generateSummaryPrompt');
    getCommitMessageSystemPrompt = jest
        .fn()
        .mockReturnValue(
            'You are a git commit message generator. Your task is to write clear, concise, and descriptive commit messages that follow best practices. Always use the imperative mood and focus on the intent and impact of the change. Do not include file names, code snippets, or unnecessary details. Never include explanations, commentary, or formatting outside the commit message itself.',
        );
}

describe('AICommitMessageService', () => {
    let configService: MockConfigService;
    let openai: MockOpenAI;
    let promptService: MockPromptService;
    let service: AICommitMessageService;

    beforeEach(() => {
        const container = new Container({ defaultScope: 'Singleton' });
        container.bind(OpenAI).to(MockOpenAI as unknown as typeof OpenAI);
        container.bind(ConfigService).to(MockConfigService as unknown as typeof ConfigService);
        container.bind(PromptService).to(MockPromptService as unknown as typeof PromptService);
        container.bind(AICommitMessageService).toSelf();

        configService = container.get<MockConfigService>(ConfigService as unknown as typeof MockConfigService);
        openai = container.get<MockOpenAI>(OpenAI as unknown as typeof MockOpenAI);
        promptService = container.get<MockPromptService>(PromptService as unknown as typeof MockPromptService);
        service = container.get(AICommitMessageService);
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

        configService.getConfig.mockResolvedValue(config);

        openai.chat.completions.create.mockResolvedValueOnce({
            choices: [{ message: { content: 'Commit message 1.' } }, { message: { content: 'Commit message 2.' } }],
        });

        openai.chat.completions.create.mockResolvedValueOnce({
            choices: [{ message: { content: 'Summary 1' } }, { message: { content: 'Summary 2' } }],
        });

        const result = await service.generateCommitMessage({ diff });

        expect(result).toEqual({
            commitMessages: ['Commit message 1', 'Commit message 2'],
            bodies: ['Summary 1', 'Summary 2'],
        });

        expect(configService.getConfig).toHaveBeenCalledTimes(1);
        expect(openai.chat.completions.create).toHaveBeenCalledTimes(2);
        expect(promptService.generateCommitMessagePrompt).toHaveBeenCalledWith('en', 50, 'feat');
        expect(promptService.generateSummaryPrompt).toHaveBeenCalledWith('en');
    });
});
