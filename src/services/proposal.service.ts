import { Inject, Injectable } from '../utils/inversify';
import { AICommitMessageService } from './ai-commit-message.service';
import { KnownError } from '../utils/error';
import { REVIEW_PROMPT, type ReviewPrompt } from './review-prompt.interface';

export interface Proposal {
    subject: string;
    body: string;
}

export type ReviewOutcome = { accepted: true; proposal: Proposal; commitMessage: string } | { accepted: false };

/**
 * A Proposal is the subject+body pair offered to the user; a commit message is
 * the accepted subject+body joined by a blank line.
 */
export const buildCommitMessage = (subject: string, body: string): string => `${subject}\n\n${body}`.trim();

/**
 * Owns the Proposal lifecycle: generate -> streaming display -> the
 * accept/revise/edit ladder -> outcome. The clack UI is behind the
 * ReviewPrompt seam; generation stays behind the AICommitMessageService
 * `{diff, revision, onDelta}` seam.
 */
@Injectable()
export class ProposalService {
    constructor(
        @Inject(REVIEW_PROMPT) private readonly reviewPrompt: ReviewPrompt,
        @Inject(AICommitMessageService) private readonly aiCommitMessageService: AICommitMessageService,
    ) {}

    async review({ diff }: { diff: string }): Promise<ReviewOutcome> {
        this.reviewPrompt.startProgress('The AI is analyzing your changes');

        let messageBuffer = '';

        // Use streaming API to generate and display commit message in real-time
        const { subject, body } = await this.aiCommitMessageService.generate({
            diff,
            onDelta: ({ part, stream }) => {
                if (stream !== 'subject') {
                    return;
                }
                messageBuffer += part;
                const previewContent =
                    messageBuffer.length > 50 ? messageBuffer.substring(0, 47) + '...' : messageBuffer;
                this.reviewPrompt.updateProgress(`Generating commit message: ${previewContent}`);
            },
        });

        this.reviewPrompt.stopProgress('Commit message generated');

        if (!subject) {
            throw new KnownError('No commit message was generated. Try again.');
        }

        this.reviewPrompt.showProposal('Generated commit message:', 'Commit body:', subject, body);

        let currentSubject = subject;
        let currentBody = body;

        for (let i = 0; i < 10; i++) {
            const confirmed = await this.reviewPrompt.askChoice(currentSubject, currentBody);

            if (confirmed === 'accept') {
                return {
                    accepted: true,
                    proposal: { subject: currentSubject, body: currentBody },
                    commitMessage: buildCommitMessage(currentSubject, currentBody),
                };
            } else if (confirmed === 'cancel') {
                this.reviewPrompt.announce('Commit cancelled');
                return { accepted: false };
            } else if (confirmed === 'revise') {
                const userPrompt = await this.reviewPrompt.askRevisionPrompt();
                if (userPrompt === null) {
                    this.reviewPrompt.announce('Commit cancelled');
                    return { accepted: false };
                }

                this.reviewPrompt.startProgress('The AI is revising your commit message');

                let messageBuffer = '';

                // Use streaming to show revision in real-time
                const { subject, body } = await this.aiCommitMessageService.generate({
                    diff,
                    revision: userPrompt,
                    onDelta: ({ part, stream }) => {
                        if (stream !== 'subject') {
                            return;
                        }
                        messageBuffer += part;
                        const previewContent =
                            messageBuffer.length > 50 ? messageBuffer.substring(0, 47) + '...' : messageBuffer;
                        this.reviewPrompt.updateProgress(`Revising: ${previewContent}`);
                    },
                });
                currentSubject = subject;
                currentBody = body;

                this.reviewPrompt.stopProgress('Revision complete');

                // Display the updated message and body
                this.reviewPrompt.showProposal('Updated commit message:', 'Updated commit body:', subject, body);
            } else if (confirmed === 'edit') {
                const initial = `${currentSubject}\n\n${currentBody}`.trim();
                const edited = this.reviewPrompt.editInEditor(initial);
                if (edited === null) {
                    this.reviewPrompt.announce('Commit cancelled');
                    return { accepted: false };
                }
                // Split edited message into subject and body (first line = subject, rest = body)
                const [firstLine, ...rest] = edited.split('\n');
                currentSubject = firstLine.trim();
                currentBody = rest.join('\n').trim();
            }
        }

        this.reviewPrompt.announce('Too many revisions requested, commit cancelled.');
        return { accepted: false };
    }
}
