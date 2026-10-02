import ignore from 'ignore';
import { Inject, Injectable } from '../utils/inversify';
import { ProfileStore } from '../profile/profile-store';
import { globalIgnoreInEffect } from '../profile/config-file';

/**
 * Manages global ignore. When the user has never set it, the built-in defaults
 * are in effect; the first add/remove writes those defaults (with the change)
 * to the file, and from then on the stored list is authoritative, including `[]`.
 */
@Injectable()
export class IgnoreHandler {
    constructor(@Inject(ProfileStore) private readonly profileStore: ProfileStore) {}

    private patternsInEffect(): { patterns: string[]; usingDefaults: boolean } {
        const stored = this.profileStore.getGlobalIgnore();
        return { patterns: globalIgnoreInEffect({ globalIgnore: stored }), usingDefaults: stored === undefined };
    }

    async list(): Promise<void> {
        const { patterns, usingDefaults } = this.patternsInEffect();

        if (patterns.length === 0) {
            console.log('No global ignore patterns configured.');
            return;
        }

        console.log(usingDefaults ? 'Global ignore patterns (built-in defaults):' : 'Global ignore patterns:');
        patterns.forEach((pattern, index) => {
            console.log(`  ${index + 1}. ${pattern}`);
        });
    }

    async add(pattern: string): Promise<void> {
        const { patterns } = this.patternsInEffect();

        if (patterns.includes(pattern)) {
            console.log(`Pattern "${pattern}" is already in the ignore list.`);
            return;
        }

        this.profileStore.setGlobalIgnore([...patterns, pattern]);
        await this.profileStore.save();

        console.log(`✅ Added ignore pattern: ${pattern}`);
    }

    async remove(pattern: string): Promise<void> {
        const { patterns } = this.patternsInEffect();

        if (!patterns.includes(pattern)) {
            console.log(`Pattern "${pattern}" not found in the ignore list.`);
            return;
        }

        this.profileStore.setGlobalIgnore(patterns.filter((p) => p !== pattern));
        await this.profileStore.save();

        console.log(`✅ Removed ignore pattern: ${pattern}`);
    }

    async test(file: string): Promise<void> {
        const { patterns } = this.patternsInEffect();

        if (patterns.length === 0) {
            console.log('ℹ️  No global ignore patterns configured.');
            console.log(`📁 "${file}" would NOT be ignored.`);
            return;
        }

        if (ignore().add(patterns).ignores(file)) {
            console.log(`🚫 "${file}" would be IGNORED.`);
            const matchingPatterns = patterns.filter((pattern) => ignore().add([pattern]).ignores(file));
            if (matchingPatterns.length > 0) {
                console.log(`   Matched by pattern(s): ${matchingPatterns.join(', ')}`);
            }
        } else {
            console.log(`✅ "${file}" would NOT be ignored.`);
        }
    }
}
