import { Argument, Command } from '@commander-js/extra-typings';
import ignore from 'ignore';
import { container } from '../utils/di';
import { ConfigService } from '../services/config.service';

const ignoreListCommand = new Command('list').description('List global ignore patterns').action(async () => {
    const configService = container.get(ConfigService);
    await configService.readConfig();

    const globalIgnore = configService.getGlobalIgnorePatterns();

    if (globalIgnore.length === 0) {
        console.log('No global ignore patterns configured.');
        return;
    }

    console.log('Global ignore patterns:');
    globalIgnore.forEach((pattern, index) => {
        console.log(`  ${index + 1}. ${pattern}`);
    });
});

const ignoreAddCommand = new Command('add')
    .description('Add a global ignore pattern')
    .addArgument(new Argument('<pattern>', 'Ignore pattern to add'))
    .action(async (pattern) => {
        const configService = container.get(ConfigService);
        await configService.readConfig();

        const globalIgnore = configService.getGlobalIgnorePatterns();

        if (globalIgnore.includes(pattern)) {
            console.log(`Pattern "${pattern}" is already in the ignore list.`);
            return;
        }

        const updatedIgnore = [...globalIgnore, pattern];
        configService.setGlobalIgnorePatterns(updatedIgnore);
        await configService.flush();

        console.log(`✅ Added ignore pattern: ${pattern}`);
    });

const ignoreRemoveCommand = new Command('remove')
    .description('Remove a global ignore pattern')
    .addArgument(new Argument('<pattern>', 'Ignore pattern to remove'))
    .action(async (pattern) => {
        const configService = container.get(ConfigService);
        await configService.readConfig();

        const globalIgnore = configService.getGlobalIgnorePatterns();

        const patternIndex = globalIgnore.indexOf(pattern);
        if (patternIndex === -1) {
            console.log(`Pattern "${pattern}" not found in the ignore list.`);
            return;
        }

        const updatedIgnore = globalIgnore.filter((p) => p !== pattern);
        configService.setGlobalIgnorePatterns(updatedIgnore);
        await configService.flush();

        console.log(`✅ Removed ignore pattern: ${pattern}`);
    });

const ignoreTestCommand = new Command('test')
    .description('Test whether a file would be ignored by current global ignore patterns')
    .addArgument(new Argument('<file>', 'File path to test'))
    .action(async (file) => {
        const configService = container.get(ConfigService);
        await configService.readConfig();

        const globalIgnore = configService.getGlobalIgnorePatterns();

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
    });

export const ignoreCommand = new Command('ignore')
    .description('Manage global ignore patterns for files to exclude from commit analysis')
    .addCommand(ignoreListCommand)
    .addCommand(ignoreAddCommand)
    .addCommand(ignoreRemoveCommand)
    .addCommand(ignoreTestCommand);
