import { bgCyan, black, green, red, yellow } from 'kolorist';
import { handleCliError, KnownError } from '../utils/error';
import { isError } from '../utils/typeguards';
import { Inject, Injectable } from '../utils/inversify';
import { stripTerminalControls } from '../services/ai-commit-message.service';
import { GitService } from '../services/git.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { ProposalService } from '../services/proposal.service';
import { ProfileStore } from '../profile/profile-store';
import { DEFAULT_GLOBAL_IGNORE } from '../profile/config-file';
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
        @Inject(ProfileStore) private readonly profileStore: ProfileStore,
    ) {}

    async run({ stageAll = false }: { stageAll?: boolean } = {}): Promise<void> {
        const { resolvedProfile, gitService, promptUI, profileStore } = this;

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

            // Consent-gated first-run initialization of the tool's default
            // ignore patterns: without explicit consent nothing is hidden
            // from review and nothing is persisted to the config. The
            // prepare-commit-msg hook cannot prompt, so it never applies
            // these defaults at all.
            let exclude = resolvedProfile.exclude;
            if (resolvedProfile.globalIgnoreUnset) {
                const confirmed = await promptUI.confirm({
                    message:
                        'Initialize default ignore patterns (package-lock.json, pnpm-lock.yaml, *.lock) in your global aicommits config so these files are excluded from review?',
                });
                if (confirmed === true) {
                    profileStore.setGlobalIgnore([...DEFAULT_GLOBAL_IGNORE]);
                    await profileStore.save();
                    exclude = [...new Set([...DEFAULT_GLOBAL_IGNORE, ...exclude])];
                } else {
                    promptUI.note(
                        'ℹ️  Global ignore patterns not configured. Tool default excludes were NOT applied; every staged file is shown for review.',
                    );
                }
            }

            const staged = await gitService.getStagedDiff(exclude, resolvedProfile.settings.contextLines);

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

            const fullMessage = result.commitMessage;

            // Bind the commit to the reviewed file set from the approval artifact.
            const filesToCommit = [...staged.files];
            if (staged.filesExcludedFromReview && staged.filesExcludedFromReview.length > 0) {
                // Disclose any staged files the review artifact filtered out before committing.
                promptUI.note(
                    `Staged files excluded from review and not shown above:\n${staged.filesExcludedFromReview.join('\n')}`,
                );
                const includeExcluded = await promptUI.confirm({
                    message: 'Commit these excluded files anyway?',
                });
                if (includeExcluded !== true) {
                    promptUI.outro('Commit cancelled');
                    return;
                }
                filesToCommit.push(...staged.filesExcludedFromReview);
            }

            const committed = await gitService.commitChanges(fullMessage, filesToCommit);

            // Disclose what actually landed in the commit.
            promptUI.outro(`${green('✔')} Committed files:\n${committed.files.join('\n')}`);
        } catch (error) {
            if (isError(error)) {
                // provider/error text can carry remote-sourced bytes: neutralize
                // terminal control sequences before rendering to the user
                promptUI.outro(`${red('✖')} ${stripTerminalControls(error.message)}`);
            } else {
                promptUI.outro(`${red('✖')} An unknown error occurred`);
            }
            handleCliError(error);
            process.exit(1);
        }
    }
}
