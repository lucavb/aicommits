import { inject as Inject, injectable as Injectable } from 'inversify';
import { ConfigService } from './config.service';
import { PromptService } from './prompt.service';
import { AIProviderFactory } from './ai-provider.factory';
import { AITextGenerationService } from './ai-text-generation.service';
import { GitService } from './git.service';

export const stripTerminalControls = (s: string) =>
    s
        // remove ANSI escape sequences (CSI, OSC including OSC-8, and short-form ESC codes)
        // eslint-disable-next-line no-control-regex -- terminal-control neutralizer: intentional control-sequence matching
        .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g, '')
        // remove any remaining C0/C1 control bytes
        // eslint-disable-next-line no-control-regex -- terminal-control neutralizer: intentional control-byte stripping
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, '');

const sanitizeMessage = (message: string) =>
    stripTerminalControls(message)
        .trim()
        .replace(/[\n\r]/g, '')
        .replace(/(\w)\.$/, '$1');

// Redacted, single-line summary of a provider/stream error for the explicit
// streamText onError handler - replaces ai's default console.error(raw error)
// render, which would print remote-sourced multi-line bytes unneutralized.
// Whitespace is collapsed before stripping so newlines turn into spaces
// instead of being deleted outright.
const redactErrorForLog = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return stripTerminalControls(message.replace(/\s+/g, ' ')).trim().slice(0, 200);
};

const logStreamError =
    (stream: 'subject' | 'body') =>
    ({ error }: { error: unknown }): void => {
        console.error(`Commit-message ${stream} generation failed: ${redactErrorForLog(error)}`);
    };

@Injectable()
export class AICommitMessageService {
    constructor(
        @Inject(AIProviderFactory) private readonly aiProviderFactory: AIProviderFactory,
        @Inject(AITextGenerationService) private readonly aiTextGenerationService: AITextGenerationService,
        @Inject(ConfigService) private readonly configService: ConfigService,
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
        const config = this.configService.getConfig();
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
                    onError: logStreamError('subject'),
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
                    onError: logStreamError('body'),
                    messages: [{ role: 'user', content: userContent }],
                });
                return stripTerminalControls(await consumeStream('body', textStream)).trim();
            })(),
        ]);

        return { subject: rawSubject, body: rawBody };
    }
}
