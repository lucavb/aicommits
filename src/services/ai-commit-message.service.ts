import { inject as Inject, injectable as Injectable } from 'inversify';
import { isString } from '../utils/typeguards';
import { ConfigService } from './config.service';
import { PromptService } from './prompt.service';
import { AIProviderFactory } from './ai-provider.factory';
import { GitService } from './git.service';

const sanitizeMessage = (message: string) =>
    message
        .trim()
        .replace(/[\n\r]/g, '')
        .replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

@Injectable()
export class AICommitMessageService {
    constructor(
        @Inject(AIProviderFactory) private readonly aiProviderFactory: AIProviderFactory,
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(PromptService) private readonly promptService: PromptService,
        @Inject(GitService) private readonly gitService: GitService,
    ) {}

    async generateCommitMessage({ diff }: { diff: string }): Promise<{ commitMessages: string[]; bodies: string[] }> {
        const { locale, maxLength, type, model } = this.configService.getConfig();

        // Fetch recent commits to potentially infer style
        const recentCommits = await this.gitService.getRecentCommitMessages(5);

        const [commitMessageCompletion, commitBodyCompletion] = await Promise.all([
            this.aiProviderFactory.createProvider().generateCompletion({
                messages: [
                    {
                        role: 'system',
                        content: this.promptService.getCommitMessageSystemPrompt(),
                    },
                    {
                        role: 'user',
                        content: this.promptService.generateCommitMessagePrompt(
                            locale,
                            maxLength,
                            type ?? '',
                            recentCommits,
                        ),
                    },
                    { role: 'user', content: diff },
                ],
                model,
                n: 1,
            }),
            this.aiProviderFactory.createProvider().generateCompletion({
                messages: [
                    { role: 'system', content: this.promptService.generateSummaryPrompt(locale) },
                    { role: 'user', content: diff },
                ],
                model,
                n: 1,
            }),
        ]);

        return {
            commitMessages: deduplicateMessages(
                commitMessageCompletion.choices
                    .map((choice) => choice.message.content)
                    .filter(isString)
                    .map((content) => sanitizeMessage(content)),
            ),
            bodies: commitBodyCompletion.choices.map((choice) => choice.message.content?.trim()).filter(isString),
        };
    }

    async generateStreamingCommitMessage({
        diff,
        onMessageUpdate,
        onBodyUpdate,
        onComplete,
    }: {
        diff: string;
        onMessageUpdate: (content: string) => void;
        onBodyUpdate?: (content: string) => void;
        onComplete: (commitMessage: string, body: string) => void;
    }): Promise<void> {
        const { locale, maxLength, type, model } = this.configService.getConfig();

        // Fetch recent commits to potentially infer style
        const recentCommits = await this.gitService.getRecentCommitMessages(5);

        let commitMessage = '';
        let body = '';

        // Create promise to track both streams completion
        const streamingComplete = new Promise<void>((resolve) => {
            let messagesCompleted = 0;
            const checkComplete = () => {
                messagesCompleted++;
                if (messagesCompleted === 2) {
                    resolve();
                }
            };

            // Stream commit message
            this.aiProviderFactory.createProvider().streamCompletion({
                messages: [
                    {
                        role: 'system',
                        content: this.promptService.getCommitMessageSystemPrompt(),
                    },
                    {
                        role: 'user',
                        content: this.promptService.generateCommitMessagePrompt(
                            locale,
                            maxLength,
                            type ?? '',
                            recentCommits,
                        ),
                    },
                    { role: 'user', content: diff },
                ],
                model,
                onMessageDelta: (content) => {
                    onMessageUpdate(content);
                },
                onComplete: (finalContent) => {
                    commitMessage = sanitizeMessage(finalContent);
                    checkComplete();
                },
            });

            // Stream body
            this.aiProviderFactory.createProvider().streamCompletion({
                messages: [
                    { role: 'system', content: this.promptService.generateSummaryPrompt(locale) },
                    { role: 'user', content: diff },
                ],
                model,
                onMessageDelta: (content) => {
                    onBodyUpdate?.(content);
                },
                onComplete: (finalContent) => {
                    body = finalContent.trim();
                    checkComplete();
                },
            });
        });

        // Wait for both streams to complete
        await streamingComplete;

        // Call the completion callback with final results
        onComplete(commitMessage, body);
    }

    async reviseCommitMessage({
        diff,
        userPrompt,
    }: {
        diff: string;
        userPrompt: string;
    }): Promise<{ commitMessages: string[]; bodies: string[] }> {
        const { locale, maxLength, type, model } = this.configService.getConfig();

        // Fetch recent commits to potentially infer style
        const recentCommits = await this.gitService.getRecentCommitMessages(5);

        const [commitMessageCompletion, commitBodyCompletion] = await Promise.all([
            this.aiProviderFactory.createProvider().generateCompletion({
                messages: [
                    {
                        role: 'system',
                        content: this.promptService.getCommitMessageSystemPrompt(),
                    },
                    {
                        role: 'user',
                        content: this.promptService.generateCommitMessagePrompt(
                            locale,
                            maxLength,
                            type ?? '',
                            recentCommits,
                        ),
                    },
                    {
                        role: 'user',
                        content: `${diff}\n\nUser revision prompt: ${userPrompt}`,
                    },
                ],
                model,
                n: 1,
            }),
            this.aiProviderFactory.createProvider().generateCompletion({
                messages: [
                    {
                        role: 'system',
                        content: this.promptService.generateSummaryPrompt(locale),
                    },
                    {
                        role: 'user',
                        content: `${diff}\n\nUser revision prompt: ${userPrompt}`,
                    },
                ],
                model,
                n: 1,
            }),
        ]);

        return {
            commitMessages: deduplicateMessages(
                commitMessageCompletion.choices
                    .map((choice) => choice.message.content)
                    .filter(isString)
                    .map((content) => sanitizeMessage(content)),
            ),
            bodies: commitBodyCompletion.choices.map((choice) => choice.message.content?.trim()).filter(isString),
        };
    }

    async reviseStreamingCommitMessage({
        diff,
        userPrompt,
        onMessageUpdate,
        onBodyUpdate,
        onComplete,
    }: {
        diff: string;
        userPrompt: string;
        onMessageUpdate: (content: string) => void;
        onBodyUpdate: (content: string) => void;
        onComplete: (commitMessage: string, body: string) => void;
    }): Promise<void> {
        const { locale, maxLength, type, model } = this.configService.getConfig();

        // Fetch recent commits to potentially infer style
        const recentCommits = await this.gitService.getRecentCommitMessages(5);

        let commitMessage = '';
        let body = '';

        const streamingComplete = new Promise<void>((resolve) => {
            let messagesCompleted = 0;
            const checkComplete = () => {
                messagesCompleted++;
                if (messagesCompleted === 2) {
                    resolve();
                }
            };

            // Stream commit message
            this.aiProviderFactory.createProvider().streamCompletion({
                messages: [
                    {
                        role: 'system',
                        content: this.promptService.getCommitMessageSystemPrompt(),
                    },
                    {
                        role: 'user',
                        content: this.promptService.generateCommitMessagePrompt(
                            locale,
                            maxLength,
                            type ?? '',
                            recentCommits,
                        ),
                    },
                    {
                        role: 'user',
                        content: `${diff}\n\nUser revision prompt: ${userPrompt}`,
                    },
                ],
                model,
                onMessageDelta: (content) => {
                    onMessageUpdate(content);
                },
                onComplete: (finalContent) => {
                    commitMessage = sanitizeMessage(finalContent);
                    checkComplete();
                },
            });

            // Stream body
            this.aiProviderFactory.createProvider().streamCompletion({
                messages: [
                    {
                        role: 'system',
                        content: this.promptService.generateSummaryPrompt(locale),
                    },
                    {
                        role: 'user',
                        content: `${diff}\n\nUser revision prompt: ${userPrompt}`,
                    },
                ],
                model,
                onMessageDelta: (content) => {
                    onBodyUpdate(content);
                },
                onComplete: (finalContent) => {
                    body = finalContent.trim();
                    checkComplete();
                },
            });
        });

        // Wait for both streams to complete
        await streamingComplete;

        // Call the completion callback with final results
        onComplete(commitMessage, body);
    }
}
