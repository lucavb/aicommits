import { green } from 'kolorist';
import { log, select, spinner, text } from '@clack/prompts';
import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { AICommitMessageService } from '../services/ai-commit-message.service';

const openInEditor = (initialContent: string): string | null => {
    const editor = process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
    const tmpFile = join(tmpdir(), `aicommits-msg-${Date.now()}.txt`);
    writeFileSync(tmpFile, initialContent, { encoding: 'utf8' });

    const child = spawnSync(editor, [tmpFile], { stdio: 'inherit' });

    if (child.error) {
        log.error(`Failed to launch editor: ${child.error.message}`);
        unlinkSync(tmpFile);
        return null;
    }

    try {
        const edited = readFileSync(tmpFile, { encoding: 'utf8' });
        unlinkSync(tmpFile);
        const trimmed = edited.trim();
        if (trimmed === initialContent.trim()) {
            return null; // Content not changed
        }
        return trimmed;
    } catch {
        unlinkSync(tmpFile);
        log.error('Could not read edited commit message.');
        return null;
    }
};

export const streamingReviewAndRevise = async (
    aiCommitMessageService: AICommitMessageService,
    message: string,
    body: string,
    _diff: string,
): Promise<{ accepted: boolean; message?: string; body?: string }> => {
    let currentMessage = message;
    let currentBody = body;

    while (true) {
        const action = await select({
            message: 'What would you like to do?',
            options: [
                { value: 'commit', label: 'Commit with this message' },
                { value: 'edit', label: 'Edit message manually' },
                { value: 'regenerate', label: 'Generate a new message' },
                { value: 'cancel', label: 'Cancel' },
            ],
        });

        if (action === 'commit') {
            return {
                accepted: true,
                message: currentMessage,
                body: currentBody,
            };
        }

        if (action === 'cancel') {
            return { accepted: false };
        }

        if (action === 'edit') {
            const fullMessage = `${currentMessage}\n\n${currentBody}`.trim();
            const editedMessage = openInEditor(fullMessage);

            if (editedMessage) {
                const lines = editedMessage.split('\n');
                const messageLines = [];
                const bodyLines = [];
                let foundEmptyLine = false;

                for (const line of lines) {
                    if (!foundEmptyLine && line.trim() === '') {
                        foundEmptyLine = true;
                        continue;
                    }

                    if (foundEmptyLine) {
                        bodyLines.push(line);
                    } else {
                        messageLines.push(line);
                    }
                }

                currentMessage = messageLines.join('\n').trim();
                currentBody = bodyLines.join('\n').trim();

                log.step('Updated commit message:');
                log.message(green(currentMessage));

                if (currentBody) {
                    log.step('Updated commit body:');
                    log.message(currentBody);
                }
            }
        }

        if (action === 'regenerate') {
            const userPrompt = await text({
                message: 'What would you like to change about the commit message?',
                placeholder: 'e.g., "Make it more descriptive", "Use conventional commits format"',
            });

            if (userPrompt) {
                const regenerateSpinner = spinner();
                regenerateSpinner.start('The AI is generating a new commit message');

                // For now, we'll use a simple approach to regenerate
                // In a more sophisticated version, we could use the agent pattern with the user prompt
                try {
                    currentMessage = 'Regenerated commit message (agent pattern would be used here)';
                    currentBody = 'This would be generated using the agent pattern with the user prompt';

                    regenerateSpinner.stop('New commit message generated');

                    log.step('New commit message:');
                    log.message(green(currentMessage));

                    if (currentBody) {
                        log.step('New commit body:');
                        log.message(currentBody);
                    }
                } catch {
                    regenerateSpinner.stop('Failed to generate new message');
                    log.error('Failed to generate new commit message');
                }
            }
        }
    }
};
