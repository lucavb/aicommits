import { cyan, dim } from 'kolorist';
import { isCancel, outro, select, spinner, text } from '@clack/prompts';
import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { AICommitMessageService } from '../services/ai-commit-message.service';

export const chooseOption = async (message: string, options: string[]): Promise<string | null> => {
    const selected = await select({
        message: `${message} ${dim('(Ctrl+c to exit)')}`,
        options: options.map((value, index) => ({ label: value, value: index })),
    });

    if (typeof selected !== 'number') {
        outro('Unable to understand the selected option');
        return null;
    }

    if (isCancel(selected)) {
        outro('Commit cancelled');
        return null;
    }

    return options[selected];
};

const openInEditor = (initialContent: string): string | null => {
    const editor = process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
    const tmpFile = join(tmpdir(), `aicommits-msg-${Date.now()}.txt`);
    writeFileSync(tmpFile, initialContent, { encoding: 'utf8' });

    const child = spawnSync(editor, [tmpFile], { stdio: 'inherit' });

    if (child.error) {
        outro(`Failed to launch editor: ${child.error.message}`);
        unlinkSync(tmpFile);
        return null;
    }

    try {
        const edited = readFileSync(tmpFile, { encoding: 'utf8' });
        unlinkSync(tmpFile);
        return edited;
    } catch {
        unlinkSync(tmpFile);
        outro('Could not read edited commit message.');
        return null;
    }
};

export const reviewAndRevise = async (
    aiCommitMessageService: AICommitMessageService,
    message: string,
    body: string,
    diff: string,
): Promise<{ accepted: boolean; message?: string; body?: string }> => {
    let currentMessage = message;
    let currentBody = body;

    for (let i = 0; i < 10; i++) {
        const confirmed = await select({
            message: `Proposed commit message:\n\n${cyan(
                currentMessage,
            )}\n\n${cyan(currentBody)}\n\nWhat would you like to do?`,
            options: [
                { label: 'Accept and commit', value: 'accept' },
                { label: 'Revise with a prompt', value: 'revise' },
                { label: 'Edit in $EDITOR', value: 'edit' },
                { label: 'Cancel', value: 'cancel' },
            ],
        });

        if (confirmed === 'accept') {
            return { accepted: true, message: currentMessage, body: currentBody };
        } else if (confirmed === 'cancel' || isCancel(confirmed)) {
            outro('Commit cancelled');
            return { accepted: false };
        } else if (confirmed === 'revise') {
            const userPrompt = await text({
                message:
                    'Describe how you want to revise the commit message (e.g. "make it more descriptive", "use imperative mood", etc):',
                placeholder: 'Enter revision prompt',
            });
            if (!userPrompt || isCancel(userPrompt)) {
                outro('Commit cancelled');
                return { accepted: false };
            }
            const s = spinner();
            s.start('The AI is revising your commit message');
            const { commitMessages: revisedMessages, bodies: revisedBodies } =
                await aiCommitMessageService.reviseCommitMessage({ diff, userPrompt });
            s.stop('Revision complete');
            currentMessage = revisedMessages[0] ?? currentMessage;
            currentBody = revisedBodies[0] ?? currentBody;
        } else if (confirmed === 'edit') {
            const initial = `${currentMessage}\n\n${currentBody}`.trim();
            const edited = openInEditor(initial);
            if (edited === null) {
                outro('Commit cancelled');
                return { accepted: false };
            }
            // Split edited message into subject and body (first line = subject, rest = body)
            const [firstLine, ...rest] = edited.split('\n');
            currentMessage = firstLine.trim();
            currentBody = rest.join('\n').trim();
        }
    }
    outro('Too many revisions requested, commit cancelled.');
    return { accepted: false };
};
