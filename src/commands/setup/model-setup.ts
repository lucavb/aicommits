import { type ProfileConfig, ProviderName } from '../../utils/config';
import { type ClackPromptService } from '../../services/clack-prompt.service';
import { type ProviderModelHandler } from './providers/types';
import { openaiHandler } from './providers/openai';
import { anthropicHandler } from './providers/anthropic';
import { bedrockHandler } from './providers/bedrock';
import { ollamaHandler } from './providers/ollama';
import { openrouterHandler } from './providers/openrouter';

const handlers = {
    anthropic: anthropicHandler,
    bedrock: bedrockHandler,
    ollama: ollamaHandler,
    openai: openaiHandler,
    openrouter: openrouterHandler,
} as const satisfies Record<ProviderName, ProviderModelHandler>;

export async function setupModel(
    promptUI: ClackPromptService,
    provider: ProviderName,
    currentConfig?: Partial<ProfileConfig>,
) {
    return handlers[provider].setup(promptUI, currentConfig);
}
