import { Command } from '@commander-js/extra-typings';
import { configSchema, readConfig } from '../utils/config';
import { getStagedDiff } from '../utils/git';
import { generateCommitMessage } from '../utils/openai';

export const prepareCommitMsgCommand = new Command('prepare-commit-msg')
    .description('Runs aicommits silently and returns the first proposed text')
    .action(async () => {
        const savedConfig = await readConfig();
        const parseResult = configSchema.safeParse(savedConfig);
        if (parseResult.success) {
            const config = parseResult.data;
            const staged = await getStagedDiff(config.exclude, config.contextLines);

            if (!staged) {
                return;
            }

            const {
                commitMessages: [firstCommitMessage],
                bodies: [firstBody],
            } = await generateCommitMessage({
                ...config,
                diff: staged.diff,
                generate: 1,
            });

            if (firstCommitMessage && firstBody) {
                const fullMessage = `${firstCommitMessage}\n\n${firstBody}`.trim();
                console.log(fullMessage);
            }
        } else {
            console.error(parseResult.error.errors);
        }
    });
