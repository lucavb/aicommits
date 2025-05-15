import { inject as Inject, injectable as Injectable } from 'inversify';
import { isString } from '../utils/typeguards';
import { ConfigService } from './config.service';
import { PromptService } from './prompt.service';
import type { AIProvider, AIProviderFactory } from './ai-provider.interface';
import { AIProviderFactorySymbol } from './ai-provider.interface';

const sanitizeMessage = (message: string) =>
    message
        .trim()
        .replace(/[\n\r]/g, '')
        .replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

@Injectable()
export class AICommitMessageService {
    private provider: AIProvider | undefined;

    constructor(
        @Inject(AIProviderFactorySymbol) private readonly providerFactory: AIProviderFactory,
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(PromptService) private readonly promptService: PromptService,
    ) {}

    private async getProvider(): Promise<AIProvider> {
        if (this.provider) {
            return this.provider;
        }
        const { baseUrl, apiKey } = await this.configService.getConfig();
        this.provider = this.providerFactory.createProvider({ baseUrl, apiKey });
        return this.provider;
    }

    async generateCommitMessage({
        diff,
        generate: generateParam,
    }: {
        diff: string;
        generate?: number;
    }): Promise<{ commitMessages: string[]; bodies: string[] }> {
        const { locale, maxLength, type, model, generate } = await this.configService.getConfig();
        const provider = await this.getProvider();

        const [commitMessageCompletion, commitBodyCompletion] = await Promise.all([
            provider.generateCompletion({
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
            provider.generateCompletion({
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
        const { locale, maxLength, type, model } = await this.configService.getConfig();
        const provider = await this.getProvider();

        const [commitMessageCompletion, commitBodyCompletion] = await Promise.all([
            provider.generateCompletion({
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
            provider.generateCompletion({
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
