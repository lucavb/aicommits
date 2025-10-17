import { Injectable, Inject } from '../utils/inversify';
import { ConfigService } from './config.service';
import { type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

@Injectable()
export class AIProviderFactory {
    constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

    createModel(): LanguageModel {
        const config = this.configService.getConfig();

        switch (config.provider) {
            case 'openai': {
                const openaiProvider = createOpenAI({
                    apiKey: config.apiKey,
                    ...(config.baseUrl && { baseURL: config.baseUrl }),
                });
                return openaiProvider.chat(config.model);
            }
            case 'anthropic': {
                const anthropicProvider = createAnthropic({
                    apiKey: config.apiKey,
                    ...(config.baseUrl && { baseURL: config.baseUrl }),
                });
                return anthropicProvider.chat(config.model);
            }
            case 'bedrock': {
                try {
                    const bedrockProvider = createAmazonBedrock({
                        credentialProvider: fromNodeProviderChain(),
                    });
                    return bedrockProvider(config.model);
                } catch (error) {
                    throw new Error(
                        'AWS Bedrock authentication failed. Please configure AWS credentials:\n\n' +
                            'Option 1 - Direct credentials:\n' +
                            '  export AWS_ACCESS_KEY_ID=your-key-id\n' +
                            '  export AWS_SECRET_ACCESS_KEY=your-secret-key\n' +
                            '  export AWS_REGION=us-east-1\n\n' +
                            'Option 2 - AWS SSO:\n' +
                            '  export AWS_PROFILE=your-profile\n' +
                            '  aws sso login\n\n' +
                            'Note: Your IAM user/role needs the AmazonBedrockFullAccess policy.\n' +
                            'Model access must be requested: https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html\n\n' +
                            `Original error: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            }
            default: {
                const exhaustiveCheck: never = config;
                throw new Error(`Unknown provider: ${JSON.stringify(exhaustiveCheck)}`);
            }
        }
    }
}
