import { describe, expect, it, vi } from 'vitest';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { parseEnvironment } from '../utils/env';
import { type FileSystemApi, migrateLegacyConfig, ProfileStore } from './profile-store';

const openai = { provider: 'openai', model: 'gpt-4', baseUrl: 'https://api.openai.com/v1' };

const createStore = ({ contents, path = '/tmp/aicommits.yaml' }: { contents?: string; path?: string } = {}) => {
    const fs = {
        readFile: vi.fn(async (_path: string, _encoding: 'utf8') => {
            if (contents === undefined) {
                throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            }
            return contents;
        }),
        writeFile: vi.fn(async (_path: string, _data: string, _encoding: 'utf8') => undefined),
    } satisfies FileSystemApi;
    const store = new ProfileStore(path, fs, parseEnvironment({}));
    const written = () => yamlParse(fs.writeFile.mock.calls.at(-1)![1]);
    return { store, fs, written };
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

    it('updates a profile, merging into what was stored, and saves to the path', async () => {
        const { store, fs, written } = createStore({ contents: yamlStringify({ profiles: { default: openai } }) });
        await store.load();

        store.updateProfile('default', { model: 'gpt-5' });
        store.updateProfile('home', { provider: 'ollama', model: 'llama3' });
        await store.save();

        expect(fs.writeFile).toHaveBeenCalledWith('/tmp/aicommits.yaml', expect.any(String), 'utf8');
        expect(written().profiles).toEqual({
            default: { ...openai, model: 'gpt-5' },
            home: { provider: 'ollama', model: 'llama3' },
        });
    });

    it('distinguishes a never-set global ignore from an empty one', async () => {
        const { store, written } = createStore({ contents: yamlStringify({ profiles: {} }) });
        await store.load();
        expect(store.getGlobalIgnore()).toBeUndefined();

        store.setGlobalIgnore([]);
        await store.save();
        expect(written().globalIgnore).toEqual([]);
    });

    it('hands out snapshots that cannot mutate the store', async () => {
        const { store } = createStore({ contents: yamlStringify({ profiles: { default: openai } }) });
        const snapshot = await store.load();
        snapshot.profiles.default.model = 'mutated';
        expect(store.getRawProfile('default')?.model).toBe('gpt-4');
    });
});

describe('migrateLegacyConfig', () => {
    it('turns a single-profile file into the default profile', () => {
        expect(migrateLegacyConfig(openai)).toMatchObject({
            currentProfile: 'default',
            profiles: { default: openai },
        });
    });

    it('moves a profile-level globalIgnore to the top level', () => {
        const migrated = migrateLegacyConfig({ profiles: { default: { ...openai, globalIgnore: ['dist'] } } });
        expect(migrated.globalIgnore).toEqual(['dist']);
        expect(migrated.profiles.default).not.toHaveProperty('globalIgnore');
    });

    it('prefers a top-level globalIgnore', () => {
        const migrated = migrateLegacyConfig({
            globalIgnore: ['top'],
            profiles: { default: { ...openai, globalIgnore: ['nested'] } },
        });
        expect(migrated.globalIgnore).toEqual(['top']);
    });

    it('falls back to an empty file for garbage', () => {
        expect(migrateLegacyConfig('nonsense')).toEqual({ profiles: {}, currentProfile: 'default' });
    });
});
