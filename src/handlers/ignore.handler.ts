import ignore from 'ignore';
import { Inject, Injectable } from '../utils/inversify';
import { ConfigService } from '../services/config.service';

@Injectable()
export class IgnoreHandler {
    constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

    async list(): Promise<void> {
        await this.configService.readConfig();
        const globalIgnore = this.configService.getGlobalIgnorePatterns();

        if (globalIgnore.length === 0) {
            console.log('No global ignore patterns configured.');
            return;
        }

        console.log('Global ignore patterns:');
        globalIgnore.forEach((pattern, index) => {
            console.log(`  ${index + 1}. ${pattern}`);
        });
    }

    async add(pattern: string): Promise<void> {
        await this.configService.readConfig();
        const globalIgnore = this.configService.getGlobalIgnorePatterns();

        if (globalIgnore.includes(pattern)) {
            console.log(`Pattern "${pattern}" is already in the ignore list.`);
            return;
        }

        const updatedIgnore = [...globalIgnore, pattern];
        this.configService.setGlobalIgnorePatterns(updatedIgnore);
        await this.configService.flush();

        console.log(`✅ Added ignore pattern: ${pattern}`);
    }

    async remove(pattern: string): Promise<void> {
        await this.configService.readConfig();
        const globalIgnore = this.configService.getGlobalIgnorePatterns();

        const patternIndex = globalIgnore.indexOf(pattern);
        if (patternIndex === -1) {
            console.log(`Pattern "${pattern}" not found in the ignore list.`);
            return;
        }

        const updatedIgnore = globalIgnore.filter((p) => p !== pattern);
        this.configService.setGlobalIgnorePatterns(updatedIgnore);
        await this.configService.flush();

        console.log(`✅ Removed ignore pattern: ${pattern}`);
    }

    async test(file: string): Promise<void> {
        await this.configService.readConfig();
        const globalIgnore = this.configService.getGlobalIgnorePatterns();

        if (globalIgnore.length === 0) {
            console.log('ℹ️  No global ignore patterns configured.');
            console.log(`📁 "${file}" would NOT be ignored.`);
            return;
        }

        // Create ignore instance and add patterns
        const ig = ignore().add(globalIgnore);

        // Test if the file would be ignored
        const isIgnored = ig.ignores(file);

        if (isIgnored) {
            console.log(`🚫 "${file}" would be IGNORED.`);
            // Find which pattern(s) match
            const matchingPatterns = globalIgnore.filter((pattern) => {
                const testIg = ignore().add([pattern]);
                return testIg.ignores(file);
            });
            if (matchingPatterns.length > 0) {
                console.log(`   Matched by pattern(s): ${matchingPatterns.join(', ')}`);
            }
        } else {
            console.log(`✅ "${file}" would NOT be ignored.`);
        }
    }
}
