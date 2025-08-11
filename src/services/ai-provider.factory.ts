import { Injectable, Inject } from '../utils/inversify';
import { ConfigService } from './config.service';
import { AIProvider } from './ai-provider.interface';
import { OpenAIProvider } from './openai-provider';
import { OllamaProvider } from './ollama-provider';
import { AnthropicProvider } from './anthropic-provider';

@Injectable()
export class AIProviderFactory {
    constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

    createProvider(): AIProvider {
        const { provider, ...config } = this.configService.getConfig();

        switch (provider) {
            case 'openai': {
                return OpenAIProvider.create({ baseUrl: config.baseUrl, apiKey: config.apiKey });
            }
            case 'ollama': {
                return OllamaProvider.create({ baseUrl: config.baseUrl });
            }
            case 'anthropic': {
                return AnthropicProvider.create({ baseUrl: config.baseUrl, apiKey: config.apiKey });
            }
            default: {
                throw new Error(`Unknown provider: ${provider}`);
            }
        }
    }
}
