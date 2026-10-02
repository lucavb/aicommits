import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrepareCommitMsgHandler } from './prepare-commit-msg.handler';
import type { GitService } from '../services/git.service';
import type { AICommitMessageService } from '../services/ai-commit-message.service';
import { resolveProfile, type ResolvedProfile } from '../profile/resolved-profile';
import { parseEnvironment } from '../utils/env';

const ready = resolveProfile({
    file: { profiles: { default: { provider: 'ollama', model: 'llama3', contextLines: 5 } }, globalIgnore: ['*.lock'] },
    cliArguments: {},
    env: parseEnvironment({}),
});

describe('PrepareCommitMsgHandler', () => {
    let gitService: Pick<GitService, 'getStagedDiff'>;
    let generation: Pick<AICommitMessageService, 'generate'>;
    let stdout: ReturnType<typeof vi.spyOn>;
    let stderr: ReturnType<typeof vi.spyOn>;

    const handlerFor = (resolved: ResolvedProfile) =>
        new PrepareCommitMsgHandler(resolved, gitService as GitService, generation as AICommitMessageService);

    beforeEach(() => {
        vi.restoreAllMocks();
        gitService = { getStagedDiff: vi.fn().mockResolvedValue({ files: ['a.ts'], diff: 'the diff' }) };
        generation = { generate: vi.fn().mockResolvedValue({ subject: 'feat: add a', body: '- adds a' }) };
        stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('prints the commit message for the staged diff of the resolved profile', async () => {
        await handlerFor(ready).run();

        expect(gitService.getStagedDiff).toHaveBeenCalledWith(['*.lock'], 5);
        expect(generation.generate).toHaveBeenCalledWith({ diff: 'the diff' });
        expect(stdout).toHaveBeenCalledTimes(1);
        expect(stdout).toHaveBeenCalledWith('feat: add a\n\n- adds a');
    });

    it('prints nothing when nothing is staged', async () => {
        gitService.getStagedDiff = vi.fn().mockResolvedValue(undefined);

        await handlerFor(ready).run();

        expect(generation.generate).not.toHaveBeenCalled();
        expect(stdout).not.toHaveBeenCalled();
    });

    it.each<ResolvedProfile>([
        { status: 'missing', name: 'work', available: [] },
        { status: 'invalid', name: 'work', issues: ['model: required'] },
    ])('warns on stderr, keeps stdout clean, and does not throw when the profile is $status', async (resolved) => {
        await expect(handlerFor(resolved).run()).resolves.toBeUndefined();

        expect(stdout).not.toHaveBeenCalled();
        expect(stderr).toHaveBeenCalledWith(expect.stringContaining('profile "work"'));
        expect(gitService.getStagedDiff).not.toHaveBeenCalled();
    });
});
