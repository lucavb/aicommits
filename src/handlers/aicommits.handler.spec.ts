import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { AiCommitsHandler } from './aicommits.handler';
import type { ConfigService } from '../services/config.service';
import type { GitService } from '../services/git.service';
import type { ProposalService } from '../services/proposal.service';
import type { ConfirmOptions } from '@clack/prompts';
import type { ClackPromptService } from '../services/clack-prompt.service';

const createSpinner = () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() });

/**
 * AiCommitsHandler uses pure constructor injection, so it can be instantiated
 * directly with mocks - no DI container needed for unit testing.
 */
describe('AiCommitsHandler', () => {
    let configService: Partial<ConfigService>;
    let gitService: Partial<GitService>;
    let proposalService: Partial<ProposalService>;
    let promptUI: Partial<ClackPromptService>;
    let handler: AiCommitsHandler;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    const processExitError = new Error('process.exit called');

    /**
     * The declared `confirm` type resolves to a unique-symbol union, so the mock is
     * re-typed with a widened `symbol` to allow stubbing `Symbol.for('clack:cancel')`.
     */
    const confirmMock = () =>
        promptUI.confirm as unknown as Mock<(options: ConfirmOptions) => Promise<boolean | symbol>>;
    const getStagedDiffMock = () => gitService.getStagedDiff as NonNullable<GitService['getStagedDiff']>;

    beforeEach(() => {
        vi.clearAllMocks();

        configService = {
            readConfig: vi.fn().mockResolvedValue(undefined),
            validConfig: vi.fn().mockReturnValue({ valid: true }),
            getCurrentProfile: vi.fn().mockReturnValue('default'),
            getProfile: vi.fn().mockReturnValue({
                provider: 'openai',
                model: 'gpt-4',
                baseUrl: 'https://api.openai.com/v1',
                contextLines: 10,
                exclude: undefined,
            }),
            getProfileNames: vi.fn().mockReturnValue(['default']),
        };

        gitService = {
            assertGitRepo: vi.fn().mockResolvedValue('/repo'),
            stageAllFiles: vi.fn().mockResolvedValue(undefined),
            getStagedDiff: vi.fn().mockResolvedValue({
                files: ['a.ts'],
                diff: 'diff --git a/a.ts',
                filesExcludedFromReview: [],
            }),
            getDetectedMessage: vi.fn().mockReturnValue('Detected 1 staged file'),
            commitChanges: vi.fn().mockResolvedValue({ commit: 'abc123', files: ['a.ts'] }),
        };

        proposalService = {
            review: vi.fn().mockResolvedValue({
                accepted: true,
                proposal: { subject: 'feat: add feature', body: 'Body text' },
                commitMessage: 'feat: add feature\n\nBody text',
            }),
        };

        promptUI = {
            intro: vi.fn(),
            note: vi.fn(),
            confirm: vi.fn().mockResolvedValue(true),
            isCancel: vi.fn().mockReturnValue(false) as unknown as ClackPromptService['isCancel'],
            spinner: vi.fn().mockImplementation(createSpinner) as unknown as ClackPromptService['spinner'],
            outro: vi.fn(),
        };

        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw processExitError;
        });

        handler = new AiCommitsHandler(
            configService as ConfigService,
            gitService as GitService,
            proposalService as ProposalService,
            promptUI as ClackPromptService,
        );
    });

    it('reviews the proposal and commits the reviewed file set', async () => {
        await handler.run();

        expect(gitService.assertGitRepo).toHaveBeenCalled();
        expect(gitService.getStagedDiff).toHaveBeenCalled();
        expect(proposalService.review).toHaveBeenCalledWith({ diff: 'diff --git a/a.ts' });
        expect(gitService.commitChanges).toHaveBeenCalledWith('feat: add feature\n\nBody text', ['a.ts']);
        expect(promptUI.outro).toHaveBeenCalledWith(expect.stringContaining('Committed files:'));
        expect(promptUI.outro).toHaveBeenCalledWith(expect.stringContaining('a.ts'));
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('stages all files when stageAll is requested', async () => {
        await handler.run({ stageAll: true });

        expect(gitService.stageAllFiles).toHaveBeenCalled();
    });

    it('passes a consent callback for default ignore initialization into getStagedDiff', async () => {
        await handler.run();

        expect(gitService.getStagedDiff).toHaveBeenCalledWith(undefined, 10, {
            requestDefaultIgnoreConsent: expect.any(Function),
        });

        const options = vi.mocked(getStagedDiffMock()).mock.calls[0][2]!;
        const consent = options.requestDefaultIgnoreConsent as () => Promise<boolean>;

        vi.mocked(confirmMock()).mockResolvedValue(true);
        await expect(consent()).resolves.toBe(true);

        vi.mocked(confirmMock()).mockResolvedValue(false);
        await expect(consent()).resolves.toBe(false);
    });

    it('does not consent to default ignore initialization when the prompt is cancelled', async () => {
        await handler.run();

        const consentMock = confirmMock();
        consentMock.mockResolvedValue(Symbol.for('clack:cancel'));

        const options = vi.mocked(getStagedDiffMock()).mock.calls[0][2]!;
        const consent = options.requestDefaultIgnoreConsent as () => Promise<boolean>;
        await expect(consent()).resolves.toBe(false);
    });

    it('discloses excluded-but-staged files and skips the commit when the user declines', async () => {
        gitService.getStagedDiff = vi.fn().mockResolvedValue({
            files: ['a.ts'],
            diff: 'diff --git a/a.ts',
            filesExcludedFromReview: ['package-lock.json'],
        });

        // User declines to commit the undisclosed files.
        vi.mocked(confirmMock()).mockResolvedValue(false);

        await handler.run();

        expect(promptUI.note).toHaveBeenCalledWith(expect.stringContaining('package-lock.json'));
        expect(promptUI.confirm).toHaveBeenCalledWith({ message: 'Commit these excluded files anyway?' });
        expect(gitService.commitChanges).not.toHaveBeenCalled();
        expect(promptUI.outro).toHaveBeenCalledWith('Commit cancelled');
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('includes excluded-but-staged files in the committed set only after explicit consent', async () => {
        gitService.getStagedDiff = vi.fn().mockResolvedValue({
            files: ['a.ts'],
            diff: 'diff --git a/a.ts',
            filesExcludedFromReview: ['package-lock.json'],
        });

        await handler.run();

        expect(gitService.commitChanges).toHaveBeenCalledWith('feat: add feature\n\nBody text', [
            'a.ts',
            'package-lock.json',
        ]);
    });

    it('does not prompt about excluded files when nothing was filtered out', async () => {
        await handler.run();

        expect(promptUI.confirm).not.toHaveBeenCalled();
        expect(gitService.commitChanges).toHaveBeenCalledWith('feat: add feature\n\nBody text', ['a.ts']);
    });

    it('exits early when the config is invalid', async () => {
        configService.validConfig = vi.fn().mockReturnValue({ valid: false, errors: [] });

        await expect(handler.run()).rejects.toThrow(processExitError);

        expect(gitService.assertGitRepo).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('reports an error and exits when there are no staged changes', async () => {
        gitService.getStagedDiff = vi.fn().mockResolvedValue(undefined);

        await expect(handler.run()).rejects.toThrow(processExitError);

        expect(promptUI.outro).toHaveBeenCalledWith(expect.stringContaining('No staged changes found'));
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does not commit when the user cancels the review', async () => {
        proposalService.review = vi.fn().mockResolvedValue({ accepted: false });

        await handler.run();

        expect(gitService.commitChanges).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
    });
});
