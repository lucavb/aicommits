import { bgCyan, black, green, red, yellow } from 'kolorist';
import { handleCliError, KnownError } from '../utils/error';
import { isError } from '../utils/typeguards';
import { Inject, Injectable } from '../utils/inversify';
import { GitService } from '../services/git.service';
import { ConfigService } from '../services/config.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { ProposalService } from '../services/proposal.service';
import { trimLines } from '../utils/string';

@Injectable()
export class AiCommitsHandler {
    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(GitService) private readonly gitService: GitService,
        @Inject(ProposalService) private readonly proposalService: ProposalService,
        @Inject(ClackPromptService) private readonly promptUI: ClackPromptService,
    ) {}

    async run({ stageAll = false }: { stageAll?: boolean } = {}): Promise<void> {
        const { configService, gitService, promptUI } = this;

        try {
            await configService.readConfig();

            promptUI.intro(bgCyan(black(' aicommits ')));
            const validResult = configService.validConfig();
            if (!validResult.valid) {
                promptUI.note(
                    trimLines(`
                    It looks like you haven't set up aicommits yet. Let's get you started!
                    
                    Run ${yellow('aicommits setup')} to configure your settings.
                `),
                );
                process.exit(1);
            }

            const profile = configService.getCurrentProfile();
            const currentProfile = configService.getProfile(profile);
            if (!currentProfile) {
                const config = configService.getProfileNames();
                promptUI.note(
                    trimLines(`
                    Profile "${profile}" not found. Available profiles: ${config.join(', ')}
                    
                    Run ${yellow('aicommits setup --profile ' + profile)} to create this profile.
                `),
                );
                process.exit(1);
            }

            const config = currentProfile;

            // Display provider and model information
            const endpointInfo =
                config.provider === 'bedrock'
                    ? 'Endpoint: AWS Bedrock'
                    : `Endpoint: ${yellow('baseUrl' in config && config.baseUrl ? config.baseUrl : 'N/A')}`;

            promptUI.note(
                trimLines(`
                 Profile: ${yellow(profile)}
                 Provider: ${yellow(config.provider)}
                 Model: ${yellow(config.model)}
                 ${endpointInfo}
                `),
            );

            await gitService.assertGitRepo();

            if (stageAll) {
                const stagingSpinner = promptUI.spinner();
                stagingSpinner.start('Staging all files');
                await gitService.stageAllFiles();
                stagingSpinner.stop('All files staged');
            }

            const detectingFiles = promptUI.spinner();
            detectingFiles.start('Detecting staged files');
            const staged = await gitService.getStagedDiff(config.exclude, config.contextLines);

            if (!staged) {
                detectingFiles.stop('Detecting staged files');
                throw new KnownError(
                    trimLines(`
                        No staged changes found. Stage your changes manually, or automatically stage all changes with the \`--stage-all\` flag.
                    `),
                );
            }

            detectingFiles.stop(
                `${gitService.getDetectedMessage(staged.files)}:\n${staged.files.map((file: string) => `     ${file}`).join('\n')}`,
            );

            const result = await this.proposalService.review({ diff: staged.diff });
            if (!result.accepted) {
                return;
            }

            await this.gitService.commitChanges(result.commitMessage);

            promptUI.outro(`${green('✔')} Successfully committed`);
        } catch (error) {
            if (isError(error)) {
                promptUI.outro(`${red('✖')} ${error.message}`);
            } else {
                promptUI.outro(`${red('✖')} An unknown error occurred`);
            }
            handleCliError(error);
            process.exit(1);
        }
    }
}
