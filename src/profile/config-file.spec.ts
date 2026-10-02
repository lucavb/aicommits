import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOBAL_IGNORE, globalIgnoreInEffect, migrateLegacyConfig } from './config-file';
import { KnownError } from '../utils/error';

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

    it('throws for garbage instead of falling back to an empty file', () => {
        // Regression: the fallthrough used to substitute defaults, and the
        // next read-modify-write command would save them over the real file.
        expect(() => migrateLegacyConfig('nonsense')).toThrow(KnownError);
        expect(() => migrateLegacyConfig('nonsense', 'config.yaml')).toThrow(
            /config\.yaml exists but its format is not recognized/,
        );
        expect(() => migrateLegacyConfig('nonsense')).toThrow(/refusing to overwrite it with defaults/);
    });

    it('throws for a legacy flat document that matches neither format', () => {
        // Parses as YAML, holds key material, matches neither the profiles
        // shape nor the legacy single-profile schema.
        expect(() => migrateLegacyConfig({ apiKey: 'sk-legacy', baseUrl: 'https://api.openai.com/v1' })).toThrow(
            KnownError,
        );
    });
});
