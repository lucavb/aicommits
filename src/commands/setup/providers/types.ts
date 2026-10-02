import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type ProfileConfig } from '../../../utils/config';
import { type Credential } from '../../../profile/resolved-profile';

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
    /** Where this profile's credential would come from, given the API key currently stored in it. */
    locateCredential: (profileApiKey?: string) => Credential;
}

export interface ProviderModelHandler {
    setup(
        promptUI: ClackPromptService,
        context: ModelSetupContext,
        currentConfig?: Partial<ProfileConfig>,
    ): Promise<ModelSetupResult>;
}
