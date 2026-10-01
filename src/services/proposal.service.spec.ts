import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { AICommitMessageService } from './ai-commit-message.service';
import type { ReviewChoice, ReviewPrompt } from './review-prompt.interface';
import { buildCommitMessage, ProposalService } from './proposal.service';
import { KnownError } from '../utils/error';

type GenerateCall = {
    diff: string;
    revision?: string;
    onDelta?: (delta: { part: string; stream: 'subject' | 'body' }) => void;
};

class ScriptedReviewPrompt implements ReviewPrompt {
    choices: ReviewChoice[] = [];
    revisionPrompts: (string | null)[] = [];
    editedText: string | null = null;
    // Recorded calls
    startProgressCalls: string[] = [];
    updateProgressCalls: string[] = [];
    stopProgressCalls: string[] = [];
    showProposalCalls: { subjectTitle: string; bodyTitle: string; subject: string; body: string }[] = [];
    announceCalls: string[] = [];

    async askChoice(): Promise<ReviewChoice> {
        return this.choices.shift() ?? 'cancel';
    }

    async askRevisionPrompt(): Promise<string | null> {
        return this.revisionPrompts.shift() ?? null;
    }

    startProgress(message: string): void {
        this.startProgressCalls.push(message);
    }

    updateProgress(message: string): void {
        this.updateProgressCalls.push(message);
    }

    stopProgress(message: string): void {
        this.stopProgressCalls.push(message);
    }

    showProposal(subjectTitle: string, bodyTitle: string, subject: string, body: string): void {
        this.showProposalCalls.push({ subjectTitle, bodyTitle, subject, body });
    }

    announce(message: string): void {
        this.announceCalls.push(message);
    }

    editInEditor(): string | null {
        return this.editedText;
    }
}

const generateResult = { subject: 'Fix bug', body: 'Detail' };

const createProposalService = (
    reviewPrompt: ScriptedReviewPrompt,
    generate: (call: GenerateCall) => Promise<{ subject: string; body: string }>,
) => {
    const generateFn = vi.fn((call: GenerateCall) => generate(call));
    const aiCommitMessageService = { generate: generateFn } as unknown as AICommitMessageService;
    const service = new ProposalService(reviewPrompt, aiCommitMessageService);
    return { service, generateFn };
};

describe('ProposalService', () => {
    it('accepts the first proposal and commits', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        reviewPrompt.choices = ['accept'];
        const { service, generateFn } = createProposalService(reviewPrompt, () => Promise.resolve(generateResult));

        const outcome = await service.review({ diff: 'the diff' });

        expect(outcome).toEqual({
            accepted: true,
            proposal: { subject: 'Fix bug', body: 'Detail' },
            commitMessage: 'Fix bug\n\nDetail',
        });
        expect(reviewPrompt.startProgressCalls).toEqual(['The AI is analyzing your changes']);
        expect(reviewPrompt.stopProgressCalls).toEqual(['Commit message generated']);
        expect(reviewPrompt.showProposalCalls).toEqual([
            {
                subjectTitle: 'Generated commit message:',
                bodyTitle: 'Commit body:',
                subject: 'Fix bug',
                body: 'Detail',
            },
        ]);
        expect(generateFn).toHaveBeenCalledTimes(1);
        expect(generateFn.mock.calls[0][0]).not.toHaveProperty('revision');
    });

    it('revises with a prompt and then accepts the second proposal', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        reviewPrompt.choices = ['revise', 'accept'];
        reviewPrompt.revisionPrompts = ['make it shorter'];
        const { service, generateFn } = createProposalService(reviewPrompt, ({ revision }) => {
            if (revision === 'make it shorter') {
                return Promise.resolve({ subject: 'Fix bug quickly', body: 'Short detail' });
            }
            return Promise.resolve(generateResult);
        });

        const outcome = await service.review({ diff: 'the diff' });

        expect(outcome).toEqual({
            accepted: true,
            proposal: { subject: 'Fix bug quickly', body: 'Short detail' },
            commitMessage: 'Fix bug quickly\n\nShort detail',
        });
        expect(generateFn).toHaveBeenCalledTimes(2);
        expect(generateFn.mock.calls[1][0].revision).toBe('make it shorter');
        expect(reviewPrompt.startProgressCalls[1]).toBe('The AI is revising your commit message');
        expect(reviewPrompt.showProposalCalls[1]).toEqual({
            subjectTitle: 'Updated commit message:',
            bodyTitle: 'Updated commit body:',
            subject: 'Fix bug quickly',
            body: 'Short detail',
        });
    });

    it('edits the proposal in an editor and accepts the edited result', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        reviewPrompt.choices = ['edit', 'accept'];
        reviewPrompt.editedText = 'Edited subject\n\nEdited body line 1\nline 2';
        const { service, generateFn } = createProposalService(reviewPrompt, () => Promise.resolve(generateResult));

        const outcome = await service.review({ diff: 'the diff' });

        expect(outcome).toEqual({
            accepted: true,
            proposal: { subject: 'Edited subject', body: 'Edited body line 1\nline 2' },
            commitMessage: 'Edited subject\n\nEdited body line 1\nline 2',
        });
        expect(generateFn).toHaveBeenCalledTimes(1);
    });

    it('cancels when the user picks cancel', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        reviewPrompt.choices = ['cancel'];
        const { service } = createProposalService(reviewPrompt, () => Promise.resolve(generateResult));

        const outcome = await service.review({ diff: 'the diff' });

        expect(outcome).toEqual({ accepted: false });
        expect(reviewPrompt.announceCalls).toEqual(['Commit cancelled']);
    });

    it('cancels when the revision prompt is empty or cancelled', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        reviewPrompt.choices = ['revise'];
        reviewPrompt.revisionPrompts = [null];
        const { service, generateFn } = createProposalService(reviewPrompt, () => Promise.resolve(generateResult));

        const outcome = await service.review({ diff: 'the diff' });

        expect(outcome).toEqual({ accepted: false });
        expect(reviewPrompt.announceCalls).toEqual(['Commit cancelled']);
        expect(generateFn).toHaveBeenCalledTimes(1);
    });

    it('cancels when the editor returns null', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        reviewPrompt.choices = ['edit'];
        reviewPrompt.editedText = null;
        const { service } = createProposalService(reviewPrompt, () => Promise.resolve(generateResult));

        const outcome = await service.review({ diff: 'the diff' });

        expect(outcome).toEqual({ accepted: false });
        expect(reviewPrompt.announceCalls).toEqual(['Commit cancelled']);
    });

    it('cancels after too many revisions', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        reviewPrompt.choices = Array.from({ length: 10 }, () => 'revise' as ReviewChoice);
        reviewPrompt.revisionPrompts = Array.from({ length: 10 }, () => 'again');
        const { service, generateFn } = createProposalService(reviewPrompt, () => Promise.resolve(generateResult));

        const outcome = await service.review({ diff: 'the diff' });

        expect(outcome).toEqual({ accepted: false });
        expect(reviewPrompt.announceCalls).toEqual(['Too many revisions requested, commit cancelled.']);
        // 1 initial generate + 10 revision generates (one per loop iteration)
        expect(generateFn).toHaveBeenCalledTimes(11);
    });

    it('throws a KnownError when no subject was generated', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        const { service } = createProposalService(reviewPrompt, () => Promise.resolve({ subject: '', body: 'x' }));

        await expect(service.review({ diff: 'the diff' })).rejects.toThrow(
            new KnownError('No commit message was generated. Try again.'),
        );
    });

    it('wires onDelta subject deltas into the generating preview', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        reviewPrompt.choices = ['accept'];
        const { service } = createProposalService(reviewPrompt, ({ onDelta }) => {
            onDelta?.({ part: 'a'.repeat(60), stream: 'subject' });
            return Promise.resolve(generateResult);
        });

        const outcome = await service.review({ diff: 'the diff' });

        expect(outcome.accepted).toBe(true);
        const generatingCall = reviewPrompt.updateProgressCalls.find((call) =>
            call.startsWith('Generating commit message: '),
        );
        expect(generatingCall).toBe(`Generating commit message: ${'a'.repeat(47)}...`);
    });

    it('neutralizes terminal control sequences before they reach the generating preview', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        reviewPrompt.choices = ['accept'];
        const { service } = createProposalService(reviewPrompt, ({ onDelta }) => {
            onDelta?.({ part: '\x1b[8mfix\x1b[28m login ', stream: 'subject' });
            onDelta?.({ part: 'race\x1b]8;;http://127.0.0.1/x\x07', stream: 'subject' });
            return Promise.resolve(generateResult);
        });

        await service.review({ diff: 'the diff' });

        expect(reviewPrompt.updateProgressCalls).toEqual([
            'Generating commit message: fix login ',
            'Generating commit message: fix login race',
        ]);
        for (const text of reviewPrompt.updateProgressCalls) {
            // eslint-disable-next-line no-control-regex -- intentional control-sequence assertion
            expect(text).not.toMatch(/\x1b/);
            // eslint-disable-next-line no-control-regex -- intentional control-sequence assertion
            expect(text).not.toMatch(/\u0007/);
        }
    });

    it('neutralizes terminal control sequences before they reach the revision preview', async () => {
        const reviewPrompt = new ScriptedReviewPrompt();
        reviewPrompt.choices = ['revise', 'cancel'];
        reviewPrompt.revisionPrompts = ['shorter please'];
        let firstGenerate = true;
        const { service } = createProposalService(reviewPrompt, ({ onDelta }) => {
            if (firstGenerate) {
                firstGenerate = false;
                return Promise.resolve(generateResult);
            }
            onDelta?.({ part: '\x1b[8mfix\x1b[28m login ', stream: 'subject' });
            onDelta?.({ part: 'race\x1b]8;;http://127.0.0.1/x\x07', stream: 'subject' });
            return Promise.resolve(generateResult);
        });

        await service.review({ diff: 'the diff' });

        const revisingMessages = reviewPrompt.updateProgressCalls.filter((call) => call.startsWith('Revising: '));
        expect(revisingMessages).toEqual(['Revising: fix login ', 'Revising: fix login race']);
        for (const text of reviewPrompt.updateProgressCalls) {
            // eslint-disable-next-line no-control-regex -- intentional control-sequence assertion
            expect(text).not.toMatch(/\x1b/);
            // eslint-disable-next-line no-control-regex -- intentional control-sequence assertion
            expect(text).not.toMatch(/\u0007/);
        }
    });

    it('builds commit messages from subject and body', () => {
        expect(buildCommitMessage('S', 'B')).toBe('S\n\nB');
        expect(buildCommitMessage('S', '')).toBe('S');
    });
});
