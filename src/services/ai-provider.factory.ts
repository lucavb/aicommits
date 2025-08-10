import { Injectable, Inject } from '../utils/inversify';
import { ConfigService } from './config.service';
import { type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';

@Injectable()
export class AIProviderFactory {
    constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

    createModel(): LanguageModel {
        const { provider, model, baseUrl, apiKey } = this.configService.getConfig();

        switch (provider) {
            case 'openai': {
                const openaiProvider = createOpenAI({
                    apiKey,
                    ...(baseUrl && { baseURL: baseUrl }),
                });
                return openaiProvider.chat(model);
            }
            case 'anthropic': {
                const anthropicProvider = createAnthropic({
                    apiKey,
                    ...(baseUrl && { baseURL: baseUrl }),
                });
                return anthropicProvider.chat(model);
            }
            default: {
                throw new Error(`Unknown provider: ${provider}`);
            }
        }
    }
}
