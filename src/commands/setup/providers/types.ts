import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type ProfileConfig } from '../../../utils/config';

export interface ModelChoice {
    value: string;
    label: string;
}

export interface ModelSetupResult {
    baseUrl?: string;
    apiKey?: string;
    model: string | null;
    useResponsesApi?: boolean;
}

export interface ModelSetupContext {
    profile: string;
    resolveApiKey: (profileApiKey?: string) => string | undefined;
    getApiKeySourceEnvVar: (profileApiKey?: string) => string | undefined;
}

export interface ProviderModelHandler {
    setup(
        promptUI: ClackPromptService,
        context: ModelSetupContext,
        currentConfig?: Partial<ProfileConfig>,
    ): Promise<ModelSetupResult>;
}
