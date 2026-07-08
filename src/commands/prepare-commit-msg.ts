import { Command } from '@commander-js/extra-typings';
import { runWithContainer } from '../utils/di';
import { PrepareCommitMsgHandler } from '../handlers/prepare-commit-msg.handler';

export const prepareCommitMsgCommand = new Command('prepare-commit-msg')
    .description('Runs aicommits silently and returns the first proposed text')
    .action(async () => {
        await runWithContainer({}, (container) => container.get(PrepareCommitMsgHandler).run());
    });
