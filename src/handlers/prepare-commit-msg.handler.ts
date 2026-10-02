import { Inject, Injectable } from '../utils/inversify';
import { GitService } from '../services/git.service';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { buildCommitMessage } from '../services/proposal.service';
import {
    describeUnusableProfile,
    RESOLVED_PROFILE,
    type ReadyProfile,
    type ResolvedProfile,
} from '../profile/resolved-profile';
import { isError } from '../utils/typeguards';

const warn = (message: string): void => {
    console.error(`aicommits: ${message}\nSkipping the proposal; the commit continues without one.`);
};

/**
 * Runs from a git hook: stdout becomes the commit message, so it must stay
 * clean, and a non-zero exit would block the commit. Whenever no proposal can
 * be made (unusable profile, missing API key, provider or git failure) it
 * warns on stderr and exits successfully, leaving the commit message to the user.
 */
@Injectable()
export class PrepareCommitMsgHandler {
    constructor(
        @Inject(RESOLVED_PROFILE) private readonly resolvedProfile: ResolvedProfile,
        @Inject(GitService) private readonly gitService: GitService,
        @Inject(AICommitMessageService) private readonly aiCommitMessageService: AICommitMessageService,
    ) {}

    async run(): Promise<void> {
        const { resolvedProfile } = this;

        if (resolvedProfile.status !== 'ready') {
            warn(describeUnusableProfile(resolvedProfile).join('\n'));
            return;
        }

        try {
            await this.propose(resolvedProfile);
        } catch (error) {
            warn(isError(error) ? error.message : 'An unknown error occurred');
        }
    }

    private async propose(resolvedProfile: ReadyProfile): Promise<void> {
        const staged = await this.gitService.getStagedDiff(
            resolvedProfile.exclude,
            resolvedProfile.settings.contextLines,
        );

        if (!staged) {
            return;
        }

        const { subject, body } = await this.aiCommitMessageService.generate({
            diff: staged.diff,
        });

        if (subject && body) {
            const fullMessage = buildCommitMessage(subject, body);
            console.log(fullMessage);
        }
    }
}
