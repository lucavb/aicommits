import { inject as Inject, injectable as Injectable } from 'inversify';
import { isString } from '../utils/typeguards';
import { ConfigService } from './config.service';
import { PromptService } from './prompt.service';
import { AIProviderFactory } from './ai-provider.factory';
import { AITextGenerationService } from './ai-text-generation.service';

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
        @Inject(AITextGenerationService) private readonly aiTextGenerationService: AITextGenerationService,
    ) {}

    async generateCommitMessage({ diff }: { diff: string }): Promise<{ commitMessages: string[]; bodies: string[] }> {
        const { locale, maxLength, type } = this.configService.getConfig();
        const model = this.aiProviderFactory.createModel();

        const [commitMessageResult, commitBodyResult] = await Promise.all([
            this.aiTextGenerationService.generateText({
                model,
                messages: [
                    {
                        role: 'system',
                        content: this.promptService.getCommitMessageSystemPrompt(),
                    },
                    {
                        role: 'user',
                        content: this.promptService.generateCommitMessagePrompt(locale, maxLength, type ?? ''),
                    },
                    { role: 'user', content: diff },
                ],
            }),
            this.aiTextGenerationService.generateText({
                model,
                system: this.promptService.generateSummaryPrompt(locale),
                messages: [{ role: 'user', content: diff }],
            }),
        ]);

        return {
            commitMessages: deduplicateMessages(
                [commitMessageResult.text].filter(isString).map((content) => sanitizeMessage(content)),
            ),
            bodies: [commitBodyResult.text.trim()].filter(isString),
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
        const { locale, maxLength, type } = this.configService.getConfig();
        const model = this.aiProviderFactory.createModel();

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
            (async () => {
                const { textStream } = this.aiTextGenerationService.streamText({
                    model,
                    messages: [
                        {
                            role: 'system',
                            content: this.promptService.getCommitMessageSystemPrompt(),
                        },
                        {
                            role: 'user',
                            content: this.promptService.generateCommitMessagePrompt(locale, maxLength, type ?? ''),
                        },
                        { role: 'user', content: diff },
                    ],
                });

                for await (const textPart of textStream) {
                    commitMessage += textPart;
                    onMessageUpdate(textPart);
                }

                commitMessage = sanitizeMessage(commitMessage);
                checkComplete();
            })();

            // Stream body
            (async () => {
                const { textStream } = this.aiTextGenerationService.streamText({
                    messages: [{ role: 'user', content: diff }],
                    model,
                    system: this.promptService.generateSummaryPrompt(locale),
                });

                for await (const textPart of textStream) {
                    body += textPart;
                    onBodyUpdate?.(textPart);
                }

                body = body.trim();
                checkComplete();
            })();
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
        const { locale, maxLength, type } = this.configService.getConfig();
        const model = this.aiProviderFactory.createModel();

        const [commitMessageResult, commitBodyResult] = await Promise.all([
            this.aiTextGenerationService.generateText({
                model,
                messages: [
                    {
                        role: 'system',
                        content: this.promptService.getCommitMessageSystemPrompt(),
                    },
                    {
                        role: 'user',
                        content: this.promptService.generateCommitMessagePrompt(locale, maxLength, type ?? ''),
                    },
                    {
                        role: 'user',
                        content: `${diff}\n\nUser revision prompt: ${userPrompt}`,
                    },
                ],
            }),
            this.aiTextGenerationService.generateText({
                model,
                system: this.promptService.generateSummaryPrompt(locale),
                messages: [
                    {
                        role: 'user',
                        content: `${diff}\n\nUser revision prompt: ${userPrompt}`,
                    },
                ],
            }),
        ]);

        return {
            commitMessages: deduplicateMessages(
                [commitMessageResult.text].filter(isString).map((content) => sanitizeMessage(content)),
            ),
            bodies: [commitBodyResult.text.trim()].filter(isString),
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
        const { locale, maxLength, type } = this.configService.getConfig();
        const model = this.aiProviderFactory.createModel();

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
            (async () => {
                const { textStream } = this.aiTextGenerationService.streamText({
                    model,
                    messages: [
                        {
                            role: 'system',
                            content: this.promptService.getCommitMessageSystemPrompt(),
                        },
                        {
                            role: 'user',
                            content: this.promptService.generateCommitMessagePrompt(locale, maxLength, type ?? ''),
                        },
                        {
                            role: 'user',
                            content: `${diff}\n\nUser revision prompt: ${userPrompt}`,
                        },
                    ],
                });

                for await (const textPart of textStream) {
                    commitMessage += textPart;
                    onMessageUpdate(textPart);
                }

                commitMessage = sanitizeMessage(commitMessage);
                checkComplete();
            })();

            // Stream body
            (async () => {
                const { textStream } = this.aiTextGenerationService.streamText({
                    model,
                    system: this.promptService.generateSummaryPrompt(locale),
                    messages: [
                        {
                            role: 'user',
                            content: `${diff}\n\nUser revision prompt: ${userPrompt}`,
                        },
                    ],
                });

                for await (const textPart of textStream) {
                    body += textPart;
                    onBodyUpdate(textPart);
                }

                body = body.trim();
                checkComplete();
            })();
        });

        // Wait for both streams to complete
        await streamingComplete;

        // Call the completion callback with final results
        onComplete(commitMessage, body);
    }
}
