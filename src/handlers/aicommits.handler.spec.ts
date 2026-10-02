import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiCommitsHandler } from './aicommits.handler';
import type { GitService } from '../services/git.service';
import type { ProposalService } from '../services/proposal.service';
import type { ClackPromptService } from '../services/clack-prompt.service';
import { resolveProfile, type ResolvedProfile } from '../profile/resolved-profile';
import { parseEnvironment } from '../utils/env';

const createSpinner = () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() });

const openai = { provider: 'openai', model: 'gpt-4', baseUrl: 'https://api.openai.com/v1' } as const;

/**
 * AiCommitsHandler uses pure constructor injection, so it can be instantiated
 * directly with fakes. The resolved profile is real data from resolveProfile.
 */
describe('AiCommitsHandler', () => {
    let gitService: Partial<GitService>;
    let proposalService: Partial<ProposalService>;
    let promptUI: Partial<ClackPromptService>;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    const processExitError = new Error('process.exit called');

    const handlerFor = (resolved: ResolvedProfile) =>
        new AiCommitsHandler(
            resolved,
            gitService as GitService,
            proposalService as ProposalService,
            promptUI as ClackPromptService,
        );

    const ready = resolveProfile({
        file: { profiles: { default: { ...openai, exclude: ['*.snap'] } }, globalIgnore: ['dist/**'] },
        cliArguments: { model: 'gpt-5', contextLines: 3, exclude: ['docs/**'] },
        env: parseEnvironment({ OPENAI_API_KEY: 'sk-env' }),
    });

    const notes = () => vi.mocked(promptUI.note!).mock.calls.map(([message]) => String(message));

    beforeEach(() => {
        vi.clearAllMocks();

        gitService = {
            assertGitRepo: vi.fn().mockResolvedValue('/repo'),
            stageAllFiles: vi.fn().mockResolvedValue(undefined),
            getStagedDiff: vi.fn().mockResolvedValue({ files: ['a.ts'], diff: 'diff --git a/a.ts' }),
            getDetectedMessage: vi.fn().mockReturnValue('Detected 1 staged file'),
            commitChanges: vi.fn().mockResolvedValue(undefined),
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
            spinner: vi.fn().mockImplementation(createSpinner) as unknown as ClackPromptService['spinner'],
            outro: vi.fn(),
        };

        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw processExitError;
        });
    });

    it('reviews the proposal and commits the staged changes', async () => {
        await handlerFor(ready).run();

        expect(gitService.assertGitRepo).toHaveBeenCalled();
        expect(proposalService.review).toHaveBeenCalledWith({ diff: 'diff --git a/a.ts' });
        expect(gitService.commitChanges).toHaveBeenCalledWith('feat: add feature\n\nBody text');
        expect(promptUI.outro).toHaveBeenCalledWith(expect.stringContaining('Successfully committed'));
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('reads the diff with the merged excludes and the overridden context lines', async () => {
        await handlerFor(ready).run();

        expect(gitService.getStagedDiff).toHaveBeenCalledWith(['dist/**', '*.snap', 'docs/**'], 3);
    });

    it('shows the settings actually in use, including where the API key came from', async () => {
        await handlerFor(ready).run();

        const [profileNote] = notes();
        expect(profileNote).toContain('gpt-5');
        expect(profileNote).not.toContain('gpt-4');
        expect(profileNote).toContain('OPENAI_API_KEY');
        expect(profileNote).not.toContain('sk-env');
    });

    it('stages all files when stageAll is requested', async () => {
        await handlerFor(ready).run({ stageAll: true });

        expect(gitService.stageAllFiles).toHaveBeenCalled();
    });

    it('asks a new user to run setup when no profiles exist', async () => {
        await expect(handlerFor({ status: 'missing', name: 'default', available: [] }).run()).rejects.toThrow(
            processExitError,
        );

        expect(notes()[0]).toContain("haven't set up aicommits yet");
        expect(gitService.assertGitRepo).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('lists the available profiles when the selected one is missing', async () => {
        await expect(handlerFor({ status: 'missing', name: 'work', available: ['home'] }).run()).rejects.toThrow(
            processExitError,
        );

        expect(notes()[0]).toContain('Profile "work" not found. Available profiles: home');
    });

    it('explains what is wrong with an invalid profile', async () => {
        await expect(
            handlerFor({
                status: 'invalid',
                name: 'work',
                cause: 'profile',
                issues: ['useResponsesApi: expected boolean'],
            }).run(),
        ).rejects.toThrow(processExitError);

        expect(notes()[0]).toContain('Profile "work" is invalid');
        expect(notes()[0]).toContain('useResponsesApi: expected boolean');
        expect(gitService.assertGitRepo).not.toHaveBeenCalled();
    });

    it('reports an error and exits when there are no staged changes', async () => {
        gitService.getStagedDiff = vi.fn().mockResolvedValue(undefined);

        await expect(handlerFor(ready).run()).rejects.toThrow(processExitError);

        expect(promptUI.outro).toHaveBeenCalledWith(expect.stringContaining('No staged changes found'));
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does not commit when the user cancels the review', async () => {
        proposalService.review = vi.fn().mockResolvedValue({ accepted: false });

        await handlerFor(ready).run();

        expect(gitService.commitChanges).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
    });
});
