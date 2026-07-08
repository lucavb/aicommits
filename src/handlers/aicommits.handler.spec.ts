import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiCommitsHandler } from './aicommits.handler';
import type { ConfigService } from '../services/config.service';
import type { GitService } from '../services/git.service';
import type { AICommitMessageService } from '../services/ai-commit-message.service';
import type { ClackPromptService } from '../services/clack-prompt.service';

vi.mock('../commands/aicommits-utils', () => ({
    streamingReviewAndRevise: vi.fn(),
}));

import { streamingReviewAndRevise } from '../commands/aicommits-utils';

const createSpinner = () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() });

/**
 * AiCommitsHandler uses pure constructor injection, so it can be instantiated
 * directly with mocks - no DI container needed for unit testing.
 */
describe('AiCommitsHandler', () => {
    let configService: Partial<ConfigService>;
    let gitService: Partial<GitService>;
    let aiCommitMessageService: Partial<AICommitMessageService>;
    let promptUI: Partial<ClackPromptService>;
    let handler: AiCommitsHandler;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    const processExitError = new Error('process.exit called');

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
            getStagedDiff: vi.fn().mockResolvedValue({ files: ['a.ts'], diff: 'diff --git a/a.ts' }),
            getDetectedMessage: vi.fn().mockReturnValue('Detected 1 staged file'),
            commitChanges: vi.fn().mockResolvedValue(undefined),
        };

        aiCommitMessageService = {
            generateStreamingCommitMessage: vi.fn().mockImplementation(async ({ onComplete }) => {
                onComplete('feat: add feature', 'Body text');
            }),
        };

        promptUI = {
            intro: vi.fn(),
            note: vi.fn(),
            spinner: vi.fn().mockImplementation(createSpinner) as unknown as ClackPromptService['spinner'],
            log: { step: vi.fn(), message: vi.fn() } as unknown as ClackPromptService['log'],
            outro: vi.fn(),
        };

        vi.mocked(streamingReviewAndRevise).mockResolvedValue({
            accepted: true,
            message: 'feat: add feature',
            body: 'Body text',
        });

        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
            throw processExitError;
        });

        handler = new AiCommitsHandler(
            configService as ConfigService,
            gitService as GitService,
            aiCommitMessageService as AICommitMessageService,
            promptUI as ClackPromptService,
        );
    });

    it('generates a commit message and commits the staged changes', async () => {
        await handler.run();

        expect(gitService.assertGitRepo).toHaveBeenCalled();
        expect(gitService.getStagedDiff).toHaveBeenCalled();
        expect(aiCommitMessageService.generateStreamingCommitMessage).toHaveBeenCalled();
        expect(gitService.commitChanges).toHaveBeenCalledWith('feat: add feature\n\nBody text');
        expect(promptUI.outro).toHaveBeenCalledWith(expect.stringContaining('Successfully committed'));
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('stages all files when stageAll is requested', async () => {
        await handler.run({ stageAll: true });

        expect(gitService.stageAllFiles).toHaveBeenCalled();
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
        vi.mocked(streamingReviewAndRevise).mockResolvedValue({ accepted: false });

        await handler.run();

        expect(gitService.commitChanges).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
    });
});
