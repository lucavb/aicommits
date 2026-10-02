import { bgCyan, black, green, red, yellow } from 'kolorist';
import { handleCliError, KnownError } from '../utils/error';
import { isError } from '../utils/typeguards';
import { Inject, Injectable } from '../utils/inversify';
import { GitService } from '../services/git.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { ProposalService } from '../services/proposal.service';
import {
    describeCredentialSource,
    describeUnusableProfile,
    RESOLVED_PROFILE,
    type ReadyProfile,
    type ResolvedProfile,
} from '../profile/resolved-profile';
import { trimLines } from '../utils/string';

const profileNote = ({ name, settings, credential }: ReadyProfile): string => {
    const endpoint =
        settings.provider === 'bedrock'
            ? 'AWS Bedrock'
            : yellow('baseUrl' in settings && settings.baseUrl ? settings.baseUrl : 'N/A');

    return [
        `Profile: ${yellow(name)}`,
        `Provider: ${yellow(settings.provider)}`,
        `Model: ${yellow(settings.model)}`,
        `Endpoint: ${endpoint}`,
        ...(credential.required
            ? [`API key: ${credential.source ? yellow(describeCredentialSource(credential.source)) : red('not found')}`]
            : []),
    ].join('\n');
};

@Injectable()
export class AiCommitsHandler {
    constructor(
        @Inject(RESOLVED_PROFILE) private readonly resolvedProfile: ResolvedProfile,
        @Inject(GitService) private readonly gitService: GitService,
        @Inject(ProposalService) private readonly proposalService: ProposalService,
        @Inject(ClackPromptService) private readonly promptUI: ClackPromptService,
    ) {}

    async run({ stageAll = false }: { stageAll?: boolean } = {}): Promise<void> {
        const { resolvedProfile, gitService, promptUI } = this;

        try {
            promptUI.intro(bgCyan(black(' aicommits ')));

            if (resolvedProfile.status !== 'ready') {
                promptUI.note(describeUnusableProfile(resolvedProfile, yellow).join('\n'));
                process.exit(1);
            }

            promptUI.note(profileNote(resolvedProfile));

            await gitService.assertGitRepo();

            if (stageAll) {
                const stagingSpinner = promptUI.spinner();
                stagingSpinner.start('Staging all files');
                await gitService.stageAllFiles();
                stagingSpinner.stop('All files staged');
            }

            const detectingFiles = promptUI.spinner();
            detectingFiles.start('Detecting staged files');
            const staged = await gitService.getStagedDiff(
                resolvedProfile.exclude,
                resolvedProfile.settings.contextLines,
            );

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
