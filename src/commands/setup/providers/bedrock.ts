import { red } from 'kolorist';
import { FoundationModelSummary, InferenceProfileSummary } from '@aws-sdk/client-bedrock';
import { type ClackPromptService } from '../../../services/clack-prompt.service';
import { type ProfileConfig } from '../../../utils/config';
import { type ModelChoice, type ModelSetupResult, type ProviderModelHandler } from './types';

const hasModelId = (model: FoundationModelSummary): model is FoundationModelSummary & { modelId: string } => {
    return !!(model.modelId && model.outputModalities?.includes('TEXT'));
};

const isActiveProfile = (
    profile: InferenceProfileSummary,
): profile is InferenceProfileSummary & { inferenceProfileId: string; status: 'ACTIVE' } => {
    return !!(profile.inferenceProfileId && profile.status === 'ACTIVE');
};

async function fetchBedrockModels(): Promise<ModelChoice[]> {
    const { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } =
        await import('@aws-sdk/client-bedrock');
    const client = new BedrockClient();

    const [modelsResponse, profilesResponse] = await Promise.all([
        client.send(
            new ListFoundationModelsCommand({
                byInferenceType: 'ON_DEMAND',
                byOutputModality: 'TEXT',
            }),
        ),
        client.send(new ListInferenceProfilesCommand({})),
    ]);

    const foundationModels =
        modelsResponse.modelSummaries?.filter(hasModelId).map(
            (model) =>
                ({
                    label: model.modelName ? `${model.modelName} (${model.providerName || 'Unknown'})` : model.modelId,
                    value: model.modelId,
                }) as const,
        ) ?? [];

    const inferenceProfiles =
        profilesResponse.inferenceProfileSummaries?.filter(isActiveProfile).map(
            (profile) =>
                ({
                    label: profile.inferenceProfileName
                        ? `${profile.inferenceProfileName} (Inference Profile)`
                        : profile.inferenceProfileId,
                    value: profile.inferenceProfileId,
                }) as const,
        ) ?? [];

    const models = [...foundationModels, ...inferenceProfiles];

    if (models.length === 0) {
        throw new Error('No models found');
    }

    return models;
}

async function setupBedrockModel(
    promptUI: ClackPromptService,
    currentConfig?: Partial<ProfileConfig>,
): Promise<ModelSetupResult> {
    promptUI.note(
        'AWS Bedrock requires environment variables:\n' +
            '  • AWS_REGION or AWS_DEFAULT_REGION\n' +
            '  • AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY\n' +
            '  OR\n' +
            '  • AWS_PROFILE (with `aws sso login`)\n\n' +
            'Your IAM user/role needs AmazonBedrockFullAccess policy.',
        'AWS Credentials Setup',
    );

    const s = promptUI.spinner();
    s.start('Fetching available Bedrock models...');

    let modelChoices: ModelChoice[];
    try {
        modelChoices = await fetchBedrockModels();

        if (modelChoices.length === 0) {
            s.stop(red('No Bedrock models found. Check your AWS credentials and region.'));
            return { model: null };
        }

        s.stop('Models fetched.');
    } catch (error) {
        s.stop(red('Failed to fetch models. Check your AWS credentials and region.'));
        console.error(error instanceof Error ? error.message : String(error));
        return { model: null };
    }

    const selectedModel = await promptUI.select({
        message: 'Select the Bedrock model to use',
        options: modelChoices,
        initialValue:
            currentConfig?.model && modelChoices.some((c) => c.value === currentConfig?.model)
                ? currentConfig.model
                : modelChoices[0].value,
    });

    if (typeof selectedModel !== 'string') {
        return { model: null };
    }

    return { model: selectedModel };
}

export const bedrockHandler: ProviderModelHandler = {
    setup: setupBedrockModel,
};
