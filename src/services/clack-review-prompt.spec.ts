import { readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClackReviewPrompt } from './clack-review-prompt';

const spawnSyncMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', async () => ({
    ...(await vi.importActual<typeof import('child_process')>('child_process')),
    spawnSync: spawnSyncMock,
}));

const outroMock = vi.hoisted(() => vi.fn());
vi.mock('@clack/prompts', () => ({
    isCancel: vi.fn(),
    log: { step: vi.fn(), message: vi.fn() },
    outro: outroMock,
    select: vi.fn(),
    spinner: vi.fn(),
    text: vi.fn(),
}));

const tmpPrefix = 'aicommits-msg-';
const existingMsgEntries = () => readdirSync(tmpdir()).filter((entry) => entry.startsWith(tmpPrefix));

describe('ClackReviewPrompt.editInEditor', () => {
    let privateDirsBefore: string[];

    beforeEach(() => {
        spawnSyncMock.mockReset();
        outroMock.mockReset();
        process.env.EDITOR = 'true'; // safety net: never launch a real editor even if the mock leaks
        privateDirsBefore = existingMsgEntries();
    });

    afterEach(() => {
        // every exit path must clean up both the message file and the private directory
        expect(existingMsgEntries()).toEqual(privateDirsBefore);
    });

    it('writes and reads back through a mkdtemp private dir with a 0o600 file and returns the edited text', () => {
        let editorPath: string | undefined;
        let fileMode: number | undefined;
        let dirMode: number | undefined;
        spawnSyncMock.mockImplementation((_editor: unknown, args: string[]) => {
            editorPath = args[0];
            const fileStat = statSync(editorPath);
            const dirStat = statSync(join(editorPath, '..'));
            fileMode = fileStat.mode & 0o777;
            dirMode = dirStat.mode & 0o777;
            // the editor must be pointed at a message file inside a per-run private tmpdir subdir
            expect(basename(editorPath)).toBe('message.txt');
            expect(join(editorPath, '..').startsWith(join(tmpdir(), tmpPrefix))).toBe(true);
            expect(join(editorPath, '..')).not.toBe(tmpdir());
            // no group/other access bits on the message file
            expect(fileMode & 0o077).toBe(0);
            expect(fileMode & 0o600).toBe(0o600);
            writeFileSync(editorPath, 'Edited subject\n\nEdited body');
            return { status: 0 };
        });

        const edited = new ClackReviewPrompt().editInEditor('Proposed subject\n\nProposed body');

        expect(edited).toBe('Edited subject\n\nEdited body');
        // private directory: owner RWX only, no group/other bits
        expect(dirMode! & 0o077).toBe(0);
        expect(dirMode! & 0o700).toBe(0o700);
    });

    it('never uses a predictable epoch-millisecond name in the shared tmpdir', () => {
        spawnSyncMock.mockImplementation((_editor: unknown, args: string[]) => {
            writeFileSync(args[0], 'Edited only\n');
            return { status: 0 };
        });

        new ClackReviewPrompt().editInEditor('Initial');

        const path = spawnSyncMock.mock.calls[0][1][0] as string;
        expect(basename(path)).toBe('message.txt');
        expect(path).not.toMatch(/aicommits-msg-\d+\.txt$/);
    });

    it('cleans up and cancels when the editor fails to launch', () => {
        spawnSyncMock.mockImplementation(() => ({ status: null, error: new Error('spawn editor ENOENT') }));

        const edited = new ClackReviewPrompt().editInEditor('Initial');

        expect(edited).toBeNull();
        expect(outroMock).toHaveBeenCalledWith('Failed to launch editor: spawn editor ENOENT');
    });

    it('cleans up and cancels when the edited file cannot be read back', () => {
        // simulates an editor that deleted (or never saved) the scratch file
        spawnSyncMock.mockImplementation((_editor: unknown, args: string[]) => {
            const fileStat = statSync(args[0]);
            expect(fileStat.isFile()).toBe(true);
            unlinkSync(args[0]);
            return { status: 0 };
        });

        const edited = new ClackReviewPrompt().editInEditor('Initial');

        expect(edited).toBeNull();
        expect(outroMock).toHaveBeenCalledWith('Could not read edited commit message.');
    });
});
