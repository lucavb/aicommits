import { inject as Inject, injectable as Injectable } from 'inversify';
import { READY_PROFILE, type ReadyProfileAccessor } from '../profile/resolved-profile';
import { PromptService } from './prompt.service';
import { AIProviderFactory } from './ai-provider.factory';
import { AITextGenerationService } from './ai-text-generation.service';
import { GitService } from './git.service';

const sanitizeMessage = (message: string) =>
    message
        .trim()
        .replace(/[\n\r]/g, '')
        .replace(/(\w)\.$/, '$1');

@Injectable()
export class AICommitMessageService {
    constructor(
        @Inject(AIProviderFactory) private readonly aiProviderFactory: AIProviderFactory,
        @Inject(AITextGenerationService) private readonly aiTextGenerationService: AITextGenerationService,
        @Inject(READY_PROFILE) private readonly readyProfile: ReadyProfileAccessor,
        @Inject(GitService) private readonly gitService: GitService,
        @Inject(PromptService) private readonly promptService: PromptService,
    ) {}

    async generate({
        diff,
        revision,
        onDelta,
    }: {
        diff: string;
        revision?: string;
        onDelta?: (delta: { part: string; stream: 'subject' | 'body' }) => void;
    }): Promise<{ subject: string; body: string }> {
        const config = this.readyProfile().settings;
        const { locale, maxLength, type } = config;
        const reasoningEffort = 'reasoningEffort' in config ? config.reasoningEffort : undefined;
        const model = this.aiProviderFactory.createModel();

        const recentCommits = await this.gitService.getRecentCommitMessages(5);

        const userContent = revision ? `${diff}\n\nUser revision prompt: ${revision}` : diff;

        const consumeStream = async (stream: 'subject' | 'body', textStream: AsyncIterable<string>) => {
            let text = '';
            for await (const part of textStream) {
                text += part;
                if (onDelta && part.trim()) {
                    onDelta({ part, stream });
                }
            }
            return text;
        };

        const [rawSubject, rawBody] = await Promise.all([
            (async () => {
                const { textStream } = this.aiTextGenerationService.streamText({
                    model,
                    ...(reasoningEffort ? { reasoning: reasoningEffort } : {}),
                    instructions: this.promptService.getCommitMessageSystemPrompt(),
                    messages: [
                        {
                            role: 'user',
                            content: this.promptService.generateCommitMessagePrompt(
                                locale,
                                maxLength,
                                type ?? '',
                                recentCommits,
                            ),
                        },
                        { role: 'user', content: userContent },
                    ],
                });
                return sanitizeMessage(await consumeStream('subject', textStream));
            })(),
            (async () => {
                const { textStream } = this.aiTextGenerationService.streamText({
                    model,
                    ...(reasoningEffort ? { reasoning: reasoningEffort } : {}),
                    instructions: this.promptService.generateSummaryPrompt(locale),
                    messages: [{ role: 'user', content: userContent }],
                });
                return (await consumeStream('body', textStream)).trim();
            })(),
        ]);

        return { subject: rawSubject, body: rawBody };
    }
}
