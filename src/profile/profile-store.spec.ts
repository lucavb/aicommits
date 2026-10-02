import { promises as fs } from 'fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { parseEnvironment } from '../utils/env';
import { KnownError } from '../utils/error';
import { type FileSystemApi, ProfileStore } from './profile-store';

const openai = { provider: 'openai', model: 'gpt-4', baseUrl: 'https://api.openai.com/v1' };

/**
 * The tests exercise `ProfileStore` against an in-memory file system, so the
 * fakes are typed like the real `fs.promises` API loosely and cast once; the
 * assertions target the vi-mocked functions directly.
 */
const createFsFakes = ({ contents, fail }: { contents?: string; fail?: unknown } = {}) => {
    const readFileMock: Mock<(path: string, encoding: 'utf8') => Promise<string>> = vi.fn(async () => {
        if (fail !== undefined) {
            throw fail;
        }
        if (contents === undefined) {
            throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
        }
        return contents;
    });
    const writeFileMock: Mock<(path: string, data: string, options?: { mode?: number }) => Promise<void>> = vi.fn(
        async () => undefined,
    );
    const renameMock: Mock<(source: string, target: string) => Promise<void>> = vi.fn(async () => undefined);
    const chmodMock: Mock<(path: string, mode: number) => Promise<void>> = vi.fn(async () => undefined);
    const fileSystem = { readFile: readFileMock, writeFile: writeFileMock, rename: renameMock, chmod: chmodMock };
    return { fileSystem: fileSystem as unknown as FileSystemApi, readFileMock, writeFileMock, renameMock, chmodMock };
};

const createStore = (options?: { contents?: string; fail?: unknown; path?: string }) => {
    const { fileSystem, readFileMock, writeFileMock, renameMock, chmodMock } = createFsFakes(options);
    const path = options?.path ?? '/tmp/aicommits.yaml';
    const store = new ProfileStore(path, fileSystem, parseEnvironment({}));
    const written = () => yamlParse(writeFileMock.mock.calls.at(-1)![1]);
    return { store, readFileMock, writeFileMock, renameMock, chmodMock, written };
};

describe('ProfileStore', () => {
    it('treats a missing file as empty', async () => {
        const { store } = createStore();
        expect(await store.load()).toEqual({ profiles: {}, currentProfile: 'default' });
    });

    it('loads the profiles, current profile, and global ignore', async () => {
        const { store } = createStore({
            contents: yamlStringify({ currentProfile: 'work', globalIgnore: ['*.lock'], profiles: { work: openai } }),
        });
        expect(await store.load()).toEqual({
            currentProfile: 'work',
            globalIgnore: ['*.lock'],
            profiles: { work: openai },
        });
    });

    it('defaults the path to ~/.aicommits.yaml', () => {
        const store = new ProfileStore(undefined, {} as FileSystemApi, parseEnvironment({ HOME: '/home/me' }));
        expect(store.filePath).toBe('/home/me/.aicommits.yaml');
    });

    it('updates a profile, merging into what was stored, and saves atomically', async () => {
        const { store, writeFileMock, renameMock, chmodMock, written } = createStore({
            contents: yamlStringify({ profiles: { default: openai } }),
        });
        await store.load();

        store.updateProfile('default', { model: 'gpt-5' });
        store.updateProfile('home', { provider: 'ollama', model: 'llama3' });
        await store.save();

        // Atomic write: temp file first, owner-only mode, chmod, then rename
        // over the target.
        expect(writeFileMock).toHaveBeenCalledTimes(1);
        expect(writeFileMock).toHaveBeenCalledWith('/tmp/aicommits.yaml.tmp', expect.any(String), {
            encoding: 'utf8',
            mode: 0o600,
        });
        expect(chmodMock).toHaveBeenCalledWith('/tmp/aicommits.yaml.tmp', 0o600);
        expect(renameMock).toHaveBeenCalledWith('/tmp/aicommits.yaml.tmp', '/tmp/aicommits.yaml');

        const writtenConfig = written();
        expect(writtenConfig.profiles).toEqual({
            default: { ...openai, model: 'gpt-5' },
            home: { provider: 'ollama', model: 'llama3' },
        });
    });

    it('distinguishes a never-set global ignore from an empty one', async () => {
        const { store, written } = createStore({ contents: yamlStringify({ profiles: {} }) });
        await store.load();
        expect(store.getGlobalIgnore()).toBeUndefined();
        expect(store.getProfileNames()).toEqual([]);

        store.setGlobalIgnore([]);
        store.updateProfile('home', { provider: 'ollama', model: 'llama3' });
        await store.save();
        expect(written().globalIgnore).toEqual([]);
        expect(store.getProfileNames()).toEqual(['home']);
    });

    it('refuses to read the file a second time in one run', async () => {
        const { store, readFileMock } = createStore({ contents: yamlStringify({ profiles: { default: openai } }) });
        await store.load();

        await expect(store.load()).rejects.toThrow('read once per run');
        expect(readFileMock).toHaveBeenCalledTimes(1);
    });

    it('hands out snapshots that cannot mutate the store', async () => {
        const { store } = createStore({ contents: yamlStringify({ profiles: { default: openai } }) });
        const snapshot = await store.load();
        snapshot.profiles.default.model = 'mutated';
        expect(store.getRawProfile('default')?.model).toBe('gpt-4');
    });

    describe('read failures fail closed (never default away a damaged file)', () => {
        it('surfaces non-ENOENT read failures instead of replacing the unreadable file', async () => {
            const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
            const { store, writeFileMock, renameMock, chmodMock } = createStore({ fail: eacces });

            // load() reads the file once per run, so each failure is observed
            // through a fresh store over the same unreadable file.
            const { store: rereadStore } = createStore({ fail: eacces });
            await expect(store.load()).rejects.toThrow(KnownError);
            await expect(rereadStore.load()).rejects.toThrow('Can not read the config file /tmp/aicommits.yaml');

            // save() is refuse-to-write after a failed read: the damaged file
            // must never be overwritten with defaulted state.
            store.setGlobalIgnore(['*.log']);
            await expect(store.save()).rejects.toThrow('refusing to write');
            expect(writeFileMock).not.toHaveBeenCalled();
            expect(renameMock).not.toHaveBeenCalled();
            expect(chmodMock).not.toHaveBeenCalled();
        });

        it('surfaces corrupted YAML instead of silently replacing it', async () => {
            // Truncated mid-document copy of a previously valid profile storing an apiKey:
            // yamlParse throws instead of yielding a profiles-shaped document
            const corruptedYaml = [
                'currentProfile: default',
                'profiles:',
                '  client:',
                '    provider: openai',
                '    baseUrl: https://api.openai.com/v1',
                '    model: gpt-4',
                '      apiKey: sk-STATIC-FAKE-DO-NOT-LOOK-UP',
            ].join('\n');
            const { store, writeFileMock } = createStore({ contents: corruptedYaml });

            const { store: rereadStore } = createStore({ contents: corruptedYaml });
            await expect(store.load()).rejects.toThrow(KnownError);
            await expect(rereadStore.load()).rejects.toThrow('exists but is not valid YAML');

            store.setGlobalIgnore(['*.log']);
            await expect(store.save()).rejects.toThrow('refusing to write');
            expect(writeFileMock).not.toHaveBeenCalled();
        });

        it('fails closed on an unrecognized document format, including an empty file', async () => {
            const { store, writeFileMock } = createStore({ contents: yamlStringify({ apiKey: 'sk-legacy' }) });
            await expect(store.load()).rejects.toThrow('format is not recognized');

            const emptyFileStore = createStore({ contents: '' }).store;
            await expect(emptyFileStore.load()).rejects.toThrow('format is not recognized');

            await expect(store.save()).rejects.toThrow('refusing to write');
            expect(writeFileMock).not.toHaveBeenCalled();
        });
    });

    describe('save guards', () => {
        it('refuses to save before a successful load', async () => {
            const { store, writeFileMock } = createStore();

            await expect(store.save()).rejects.toThrow('before a successful load');
            expect(writeFileMock).not.toHaveBeenCalled();
        });

        it('fails closed when the file system API lacks rename or chmod', async () => {
            const { readFileMock, writeFileMock, renameMock, chmodMock } = createFsFakes({
                contents: yamlStringify({ profiles: { default: openai } }),
            });
            // Drop one requirement at a time; both are optional members of the
            // contract, and any save() attempt must fail closed before writing.
            const withoutRenameApi = { readFile: readFileMock, writeFile: writeFileMock, chmod: chmodMock };
            const withoutChmodApi = { readFile: readFileMock, writeFile: writeFileMock, rename: renameMock };

            const renameStore = new ProfileStore(
                '/tmp/aicommits.yaml',
                withoutRenameApi as unknown as FileSystemApi,
                parseEnvironment({}),
            );
            await renameStore.load();
            await expect(renameStore.save()).rejects.toThrow('Please open a Bug report');

            const chmodStore = new ProfileStore(
                '/tmp/aicommits.yaml',
                withoutChmodApi as unknown as FileSystemApi,
                parseEnvironment({}),
            );
            await chmodStore.load();
            await expect(chmodStore.save()).rejects.toThrow('Please open a Bug report');

            // Failing closed means nothing was ever written or renamed.
            expect(writeFileMock).not.toHaveBeenCalled();
            expect(renameMock).not.toHaveBeenCalled();
            expect(chmodMock).not.toHaveBeenCalled();
        });
    });

    describe('real file system persistence mode', () => {
        let scratchDir: string;

        afterEach(async () => {
            if (scratchDir) {
                await rm(scratchDir, { recursive: true, force: true });
            }
        });

        it('writes the credential file owner-only regardless of umask and tightens a permissive existing file', async () => {
            scratchDir = await mkdtemp(join(tmpdir(), 'aicommits-store-'));
            const configPath = join(scratchDir, 'config.yaml');
            const existingConfig = yamlStringify({
                currentProfile: 'default',
                profiles: { default: { ...openai, apiKey: 'sk-yaml-local' } },
            });
            // Simulate the legacy permissive file: created before the atomic
            // save, e.g. 0o644 under the common umask 022.
            await writeFile(configPath, existingConfig, { encoding: 'utf8', mode: 0o644 });
            expect((await stat(configPath)).mode & 0o777).toBe(0o644);

            const previous = process.umask(0o022);
            try {
                // The real fs.promises satisfies FileSystemApi including rename and chmod.
                const store = new ProfileStore(configPath, fs, parseEnvironment({}));
                await store.load();
                store.updateProfile('default', { model: 'gpt-4o-mini' });
                await store.save();

                // The atomic rename swaps in the fresh owner-only inode while
                // preserving the on-disk key material.
                const mode = (await stat(configPath)).mode & 0o777;
                expect(mode).toBe(0o600);
                const rewritten = yamlParse(await readFile(configPath, 'utf8')) as {
                    profiles: Record<string, { apiKey?: string }>;
                };
                expect(rewritten.profiles.default.apiKey).toBe('sk-yaml-local');
            } finally {
                process.umask(previous);
            }
        });

        it('leaves no temp file behind', async () => {
            scratchDir = await mkdtemp(join(tmpdir(), 'aicommits-store-'));
            const configPath = join(scratchDir, 'config.yaml');

            const store = new ProfileStore(configPath, fs, parseEnvironment({}));
            await store.load();
            await store.save();

            const entries = await readdir(scratchDir);
            expect(entries).toEqual(['config.yaml']);
        });
    });
});
