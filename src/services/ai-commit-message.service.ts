import { inject as Inject, injectable as Injectable } from 'inversify';
import { isString } from '../utils/typeguards';
import { ConfigService } from './config.service';
import { PromptService } from './prompt.service';
import { type AIProvider, AIProviderSymbol } from './ai-provider.interface';

const sanitizeMessage = (message: string) =>
    message
        .trim()
        .replace(/[\n\r]/g, '')
        .replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

@Injectable()
export class AICommitMessageService {
    constructor(
        @Inject(AIProviderSymbol) private readonly aiProvider: AIProvider,
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(PromptService) private readonly promptService: PromptService,
    ) {}

    async generateCommitMessage({
        diff,
        generate: generateParam,
    }: {
        diff: string;
        generate?: number;
    }): Promise<{ commitMessages: string[]; bodies: string[] }> {
        const { locale, maxLength, type, model, generate } = this.configService.getConfig();

        const [commitMessageCompletion, commitBodyCompletion] = await Promise.all([
            this.aiProvider.generateCompletion({
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
                model,
                n: generateParam ?? generate,
            }),
            this.aiProvider.generateCompletion({
                messages: [
                    { role: 'system', content: this.promptService.generateSummaryPrompt(locale) },
                    { role: 'user', content: diff },
                ],
                model,
                n: generateParam ?? generate,
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

    async reviseCommitMessage({
        diff,
        userPrompt,
        generate,
    }: {
        diff: string;
        userPrompt: string;
        generate?: number;
    }): Promise<{ commitMessages: string[]; bodies: string[] }> {
        const { locale, maxLength, type, model } = this.configService.getConfig();

        const [commitMessageCompletion, commitBodyCompletion] = await Promise.all([
            this.aiProvider.generateCompletion({
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
                model,
                n: generate,
            }),
            this.aiProvider.generateCompletion({
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
                n: generate,
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
}
