import { Argument, Command } from '@commander-js/extra-typings';
import { runWithContainer } from '../utils/di';
import { IgnoreHandler } from '../handlers/ignore.handler';

const withIgnoreHandler = async (callback: (handler: IgnoreHandler) => Promise<void>): Promise<void> =>
    runWithContainer({}, (container) => callback(container.get(IgnoreHandler)));

const ignoreListCommand = new Command('list')
    .description('List global ignore patterns')
    .action(async () => withIgnoreHandler((handler) => handler.list()));

const ignoreAddCommand = new Command('add')
    .description('Add a global ignore pattern')
    .addArgument(new Argument('<pattern>', 'Ignore pattern to add'))
    .action(async (pattern) => withIgnoreHandler((handler) => handler.add(pattern)));

const ignoreRemoveCommand = new Command('remove')
    .description('Remove a global ignore pattern')
    .addArgument(new Argument('<pattern>', 'Ignore pattern to remove'))
    .action(async (pattern) => withIgnoreHandler((handler) => handler.remove(pattern)));

const ignoreTestCommand = new Command('test')
    .description('Test whether a file would be ignored by current global ignore patterns')
    .addArgument(new Argument('<file>', 'File path to test'))
    .action(async (file) => withIgnoreHandler((handler) => handler.test(file)));

export const ignoreCommand = new Command('ignore')
    .description('Manage global ignore patterns for files to exclude from commit analysis')
    .addCommand(ignoreListCommand)
    .addCommand(ignoreAddCommand)
    .addCommand(ignoreRemoveCommand)
    .addCommand(ignoreTestCommand);
