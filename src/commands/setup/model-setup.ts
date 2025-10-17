import { type ProfileConfig, ProviderName } from '../../utils/config';
import { type ClackPromptService } from '../../services/clack-prompt.service';
import { type ProviderModelHandler } from './providers/types';
import { openaiHandler } from './providers/openai';
import { anthropicHandler } from './providers/anthropic';
import { bedrockHandler } from './providers/bedrock';

const handlers: Record<ProviderName, ProviderModelHandler> = {
    openai: openaiHandler,
    anthropic: anthropicHandler,
    bedrock: bedrockHandler,
};

export async function setupModel(
    promptUI: ClackPromptService,
    provider: ProviderName,
    currentConfig?: Partial<ProfileConfig>,
) {
    return handlers[provider].setup(promptUI, currentConfig);
}
