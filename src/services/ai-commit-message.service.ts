import { inject as Inject, injectable as Injectable } from 'inversify';
import OpenAI from 'openai';
import { isString } from '../utils/typeguards';
import { ConfigService } from './config.service';
import { PromptService } from './prompt.service';
import { Optional } from '../utils/inversify';

const sanitizeMessage = (message: string) =>
    message
        .trim()
        .replace(/[\n\r]/g, '')
        .replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

@Injectable()
export class AICommitMessageService {
    constructor(
        @Optional() @Inject(OpenAI) private openai: Pick<OpenAI, 'chat'> | undefined,
        private readonly configService: ConfigService,
        private readonly promptService: PromptService,
    ) {}

    private async getOpenAi(): Promise<Pick<OpenAI, 'chat'>> {
        if (this.openai) {
            return this.openai;
        }
        const { baseUrl, apiKey } = await this.configService.getConfig();
        return new OpenAI({ baseURL: baseUrl, apiKey });
    }

    async generateCommitMessage({
        diff,
        generate: generateParam,
    }: {
        diff: string;
        generate?: number;
    }): Promise<{ commitMessages: string[]; bodies: string[] }> {
        const { locale, maxLength, type, model, generate } = await this.configService.getConfig();
        const openAi = await this.getOpenAi();

        const [commitMessageCompletion, commitBodyCompletion] = await Promise.all([
            openAi.chat.completions.create({
                frequency_penalty: 0,
                messages: [
                    {
                        role: 'system',
                        content: this.promptService.generateCommitMessagePrompt(locale, maxLength, type ?? ''),
                    },
                    { role: 'user', content: diff },
                ],
                model,
                n: generateParam ?? generate,
                presence_penalty: 0,
                temperature: 0.7,
                top_p: 1,
            }),
            openAi.chat.completions.create({
                frequency_penalty: 0,
                messages: [
                    { role: 'system', content: this.promptService.generateSummaryPrompt(locale) },
                    { role: 'user', content: diff },
                ],
                model,
                n: generateParam ?? generate,
                presence_penalty: 0,
                temperature: 0.7,
                top_p: 1,
            }),
        ]);

        return {
            commitMessages: deduplicateMessages(
                commitMessageCompletion.choices
                    .map((choice) => choice.message?.content)
                    .filter(isString)
                    .map((content) => sanitizeMessage(content)),
            ),
            bodies: commitBodyCompletion.choices.map((choice) => choice.message.content?.trim()).filter(isString),
        };
    }
}
