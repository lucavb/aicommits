import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { stringify as yamlStringify } from 'yaml';
import { AiCommitsHandler } from './aicommits.handler';
import type { GitService } from '../services/git.service';
import type { ProposalService } from '../services/proposal.service';
import type { ConfirmOptions } from '@clack/prompts';
import type { ClackPromptService } from '../services/clack-prompt.service';
import { ProfileStore, type FileSystemApi } from '../profile/profile-store';
import { DEFAULT_GLOBAL_IGNORE, type ConfigFile } from '../profile/config-file';
import { resolveProfile, type ResolvedProfile } from '../profile/resolved-profile';
import { parseEnvironment } from '../utils/env';

const createSpinner = () => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() });

const openai = { provider: 'openai', model: 'gpt-4', baseUrl: 'https://api.openai.com/v1' } as const;

/**
 * AiCommitsHandler uses pure constructor injection, so it can be instantiated
 * directly with fakes. The resolved profile is real data from resolveProfile,
 * and the ProfileStore is a real store over an in-memory file system fake, so
 * the consent flow's persistence (setGlobalIgnore + save) is observable.
 */
describe('AiCommitsHandler', () => {
    let gitService: Partial<GitService>;
    let proposalService: Partial<ProposalService>;
    let promptUI: Partial<ClackPromptService>;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    const processExitError = new Error('process.exit called');

    const inMemoryStore = async (file: Partial<ConfigFile> = {}) => {
        const fsApi = {
            readFile: vi.fn(async () => yamlStringify({ profiles: {}, ...file })),
            writeFile: vi.fn(async () => undefined),
            rename: vi.fn(async () => undefined),
            chmod: vi.fn(async () => undefined),
        };
        const store = new ProfileStore(
            '/tmp/aicommits-handler-spec.yaml',
            fsApi as unknown as FileSystemApi,
            parseEnvironment({}),
        );
        // In production the composition root loads the store; mirror that here
        // so the consent flow can persist through the real save().
        await store.load();
        return { store, writeFile: fsApi.writeFile as unknown as Mock };
    };

    /** A store double for tests that never reach the persistence path. */
    const storeMock = () =>
        ({
            setGlobalIgnore: vi.fn(),
            save: vi.fn(async () => undefined),
        }) as unknown as ProfileStore;

    /**
     * The declared `confirm` type resolves to a unique-symbol union, so the mock is
     * re-typed with a widened `symbol` to allow stubbing `Symbol.for('clack:cancel')`.
     */
    const confirmMock = () =>
        promptUI.confirm as unknown as Mock<(options: ConfirmOptions) => Promise<boolean | symbol>>;
    const getStagedDiffMock = () => gitService.getStagedDiff as NonNullable<GitService['getStagedDiff']>;

    const ready = resolveProfile({
        file: { profiles: { default: { ...openai, exclude: ['*.snap'] } }, globalIgnore: ['dist/**'] },
        cliArguments: { model: 'gpt-5', contextLines: 3, exclude: ['docs/**'] },
        env: parseEnvironment({ OPENAI_API_KEY: 'sk-env' }),
    });

    const handlerFor = (resolved: ResolvedProfile, store = storeMock()) =>
        new AiCommitsHandler(
            resolved,
            gitService as GitService,
            proposalService as ProposalService,
            promptUI as ClackPromptService,
            store,
        );

    // No globalIgnore in the file: the handler must offer the built-in defaults.
    const readyWithoutGlobalIgnore = resolveProfile({
        file: { profiles: { default: { ...openai, exclude: ['*.snap'] } } },
        cliArguments: { model: 'gpt-5', contextLines: 3 },
        env: parseEnvironment({ OPENAI_API_KEY: 'sk-env' }),
    });

    // An explicit `globalIgnore: []` must be respected without a prompt.
    const readyWithGlobalIgnoreSet = resolveProfile({
        file: { profiles: { default: { ...openai, exclude: ['*.snap'] } }, globalIgnore: [] },
        cliArguments: {},
        env: parseEnvironment({ OPENAI_API_KEY: 'sk-env' }),
    });

    beforeEach(() => {
        vi.clearAllMocks();

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
    });

    it('reviews the proposal and commits the reviewed file set', async () => {
        await new AiCommitsHandler(
            ready,
            gitService as GitService,
            proposalService as ProposalService,
            promptUI as ClackPromptService,
            storeMock(),
        ).run();

        expect(gitService.assertGitRepo).toHaveBeenCalled();
        expect(proposalService.review).toHaveBeenCalledWith({ diff: 'diff --git a/a.ts' });
        expect(gitService.commitChanges).toHaveBeenCalledWith('feat: add feature\n\nBody text', ['a.ts']);
        expect(promptUI.outro).toHaveBeenCalledWith(expect.stringContaining('Committed files:'));
        expect(promptUI.outro).toHaveBeenCalledWith(expect.stringContaining('a.ts'));
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('reads the diff with the profile and CLI excludes and the overridden context lines', async () => {
        await handlerFor(ready).run();

        expect(gitService.getStagedDiff).toHaveBeenCalledWith(['dist/**', '*.snap', 'docs/**'], 3);
    });

    it('shows the settings actually in use, including where the API key came from', async () => {
        await handlerFor(ready).run();

        const profileNote = vi.mocked(promptUI.note!).mock.calls.map(([message]) => String(message));
        expect(profileNote[0]).toContain('gpt-5');
        expect(profileNote[0]).not.toContain('gpt-4');
        expect(profileNote[0]).toContain('OPENAI_API_KEY');
        expect(profileNote[0]).not.toContain('sk-env');
    });

    it('stages all files when stageAll is requested', async () => {
        await handlerFor(ready).run({ stageAll: true });

        expect(gitService.stageAllFiles).toHaveBeenCalled();
    });

    describe('consent-gated default ignore patterns', () => {
        it('offers the defaults once and, on consent, persists and applies them for this run', async () => {
            const { store, writeFile } = await inMemoryStore();
            await handlerFor(readyWithoutGlobalIgnore, store).run();

            expect(confirmMock()).toHaveBeenCalledWith({
                message:
                    'Initialize default ignore patterns (package-lock.json, pnpm-lock.yaml, *.lock) in your global aicommits config so these files are excluded from review?',
            });
            // Applied for this run: defaults first, then the explicit excludes.
            expect(getStagedDiffMock()).toHaveBeenCalledWith([...DEFAULT_GLOBAL_IGNORE, '*.snap'], 3);
            // Persisted to the config file.
            expect(store.getGlobalIgnore()).toEqual([...DEFAULT_GLOBAL_IGNORE]);
            expect(writeFile).toHaveBeenCalledWith(
                '/tmp/aicommits-handler-spec.yaml.tmp',
                expect.stringContaining('package-lock.json'),
                { encoding: 'utf8', mode: 0o600 },
            );
        });

        it('applies nothing and persists nothing when the user declines', async () => {
            const { store, writeFile } = await inMemoryStore();
            confirmMock().mockResolvedValue(false);

            await handlerFor(readyWithoutGlobalIgnore, store).run();

            expect(getStagedDiffMock()).toHaveBeenCalledWith(['*.snap'], 3);
            expect(store.getGlobalIgnore()).toBeUndefined();
            expect(writeFile).not.toHaveBeenCalled();
            expect(promptUI.note).toHaveBeenCalledWith(
                expect.stringContaining('Tool default excludes were NOT applied'),
            );
            expect(gitService.commitChanges).toHaveBeenCalled();
        });

        it('treats a cancelled prompt like a decline', async () => {
            const { store, writeFile } = await inMemoryStore();
            confirmMock().mockResolvedValue(Symbol.for('clack:cancel'));

            await handlerFor(readyWithoutGlobalIgnore, store).run();

            expect(getStagedDiffMock()).toHaveBeenCalledWith(['*.snap'], 3);
            expect(store.getGlobalIgnore()).toBeUndefined();
            expect(writeFile).not.toHaveBeenCalled();
        });

        it('does not prompt when global ignore was explicitly set, even to an empty list', async () => {
            const { store, writeFile } = await inMemoryStore();

            await handlerFor(readyWithGlobalIgnoreSet, store).run();

            expect(confirmMock()).not.toHaveBeenCalled();
            // No CLI contextLines override here, so the default of 10 applies.
            expect(getStagedDiffMock()).toHaveBeenCalledWith(['*.snap'], 10);
            expect(writeFile).not.toHaveBeenCalled();
        });

        it('does not prompt when global ignore was configured by the user', async () => {
            const { writeFile } = await inMemoryStore();

            // `ready` carries globalIgnore: ['dist/**'] from its config file.
            await handlerFor(ready).run();

            expect(confirmMock()).not.toHaveBeenCalled();
            expect(getStagedDiffMock()).toHaveBeenCalledWith(['dist/**', '*.snap', 'docs/**'], 3);
            expect(writeFile).not.toHaveBeenCalled();
        });
    });

    describe('disclosure of staged files outside the review artifact', () => {
        it('discloses excluded-but-staged files and skips the commit when the user declines', async () => {
            gitService.getStagedDiff = vi.fn().mockResolvedValue({
                files: ['a.ts'],
                diff: 'diff --git a/a.ts',
                filesExcludedFromReview: ['package-lock.json'],
            });

            // User declines to commit the undisclosed files.
            confirmMock().mockResolvedValue(false);

            await handlerFor(ready).run();

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

            await handlerFor(ready).run();

            expect(gitService.commitChanges).toHaveBeenCalledWith('feat: add feature\n\nBody text', [
                'a.ts',
                'package-lock.json',
            ]);
        });

        it('does not prompt about excluded files when nothing was filtered out', async () => {
            await handlerFor(ready).run();

            // With globalIgnore configured, the only confirm available is the excluded-files one.
            expect(confirmMock()).not.toHaveBeenCalled();
            expect(gitService.commitChanges).toHaveBeenCalledWith('feat: add feature\n\nBody text', ['a.ts']);
        });
    });

    it('asks a new user to run setup when no profiles exist', async () => {
        await expect(handlerFor({ status: 'missing', name: 'default', available: [] }).run()).rejects.toThrow(
            processExitError,
        );

        const notes = vi.mocked(promptUI.note!).mock.calls.map(([message]) => String(message));
        expect(notes[0]).toContain("haven't set up aicommits yet");
        expect(gitService.assertGitRepo).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('lists the available profiles when the selected one is missing', async () => {
        await expect(handlerFor({ status: 'missing', name: 'work', available: ['home'] }).run()).rejects.toThrow(
            processExitError,
        );

        expect(vi.mocked(promptUI.note!).mock.calls[0][0]).toContain(
            'Profile "work" not found. Available profiles: home',
        );
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

        const [note] = vi.mocked(promptUI.note!).mock.calls.map(([message]) => String(message));
        expect(note).toContain('Profile "work" is invalid');
        expect(note).toContain('useResponsesApi: expected boolean');
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
