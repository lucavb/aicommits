import { Inject, Injectable } from '../utils/inversify';
import { GitService } from '../services/git.service';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { buildCommitMessage } from '../services/proposal.service';
import { RESOLVED_PROFILE, type ResolvedProfile } from '../profile/resolved-profile';

/**
 * Runs from a git hook: stdout becomes the commit message, so it must stay
 * clean, and a non-zero exit would block the commit. When the profile is not
 * usable it warns on stderr and exits successfully without a proposal.
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
            const reason = resolvedProfile.status === 'missing' ? 'not found' : 'invalid';
            console.error(
                `aicommits: profile "${resolvedProfile.name}" is ${reason}; skipping. Run \`aicommits setup\` to fix it.`,
            );
            return;
        }

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
