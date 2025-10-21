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

export interface ProviderModelHandler {
    setup(promptUI: ClackPromptService, currentConfig?: Partial<ProfileConfig>): Promise<ModelSetupResult>;
}
