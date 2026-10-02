import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_IGNORE, globalIgnoreInEffect, migrateLegacyConfig } from './config-file';

const openai = { provider: 'openai', model: 'gpt-4', baseUrl: 'https://api.openai.com/v1' };

describe('globalIgnoreInEffect', () => {
    it('uses the built-in defaults when the user never set global ignore', () => {
        expect(globalIgnoreInEffect({})).toEqual([...DEFAULT_GLOBAL_IGNORE]);
    });

    it('respects an explicitly empty global ignore', () => {
        expect(globalIgnoreInEffect({ globalIgnore: [] })).toEqual([]);
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
