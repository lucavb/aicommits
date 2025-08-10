import { cyan, green } from 'kolorist';
import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { AIAgentService } from '../services/ai-agent.service';

const openInEditor = (
    initialContent: string,
    outroFn: ClackPromptService | ((message: string) => void),
): string | null => {
    const editor = process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
    const tmpFile = join(tmpdir(), `aicommits-msg-${Date.now()}.txt`);
    writeFileSync(tmpFile, initialContent, { encoding: 'utf8' });

    const child = spawnSync(editor, [tmpFile], { stdio: 'inherit' });

    const showOutro = (message: string) => {
        if (typeof outroFn === 'function') {
            outroFn(message);
        } else {
            outroFn.outro(message);
        }
    };

    if (child.error) {
        showOutro(`Failed to launch editor: ${child.error.message}`);
        unlinkSync(tmpFile);
        return null;
    }

    try {
        const edited = readFileSync(tmpFile, { encoding: 'utf8' });
        unlinkSync(tmpFile);
        return edited;
    } catch {
        unlinkSync(tmpFile);
        showOutro('Could not read edited commit message.');
        return null;
    }
};

export const streamingReviewAndRevise = async ({
    aiCommitMessageService,
    promptUI,
    message,
    body,
    diff,
}: {
    aiCommitMessageService: AICommitMessageService;
    promptUI: ClackPromptService;
    message: string;
    body: string;
    diff: string;
}): Promise<{ accepted: boolean; message?: string; body?: string }> => {
    let currentMessage = message;
    let currentBody = body;

    for (let i = 0; i < 10; i++) {
        const confirmed = await promptUI.select({
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
        } else if (confirmed === 'cancel' || promptUI.isCancel(confirmed)) {
            promptUI.outro('Commit cancelled');
            return { accepted: false };
        } else if (confirmed === 'revise') {
            const userPrompt = await promptUI.text({
                message:
                    'Describe how you want to revise the commit message (e.g. "make it more descriptive", "use imperative mood", etc):',
                placeholder: 'Enter revision prompt',
            });
            if (!userPrompt || promptUI.isCancel(userPrompt)) {
                promptUI.outro('Commit cancelled');
                return { accepted: false };
            }

            const reviseSpinner = promptUI.spinner();
            reviseSpinner.start('The AI is revising your commit message');

            let messageBuffer = '';

            // Use streaming to show revision in real-time
            await aiCommitMessageService.reviseStreamingCommitMessage({
                diff,
                userPrompt,
                onMessageUpdate: (content) => {
                    messageBuffer += content;
                    const previewContent =
                        messageBuffer.length > 50 ? messageBuffer.substring(0, 47) + '...' : messageBuffer;
                    reviseSpinner.message(`Revising: ${previewContent}`);
                },
                onBodyUpdate: () => {
                    // Don't show body updates in real-time
                },
                onComplete: (updatedMessage, updatedBody) => {
                    currentMessage = updatedMessage;
                    currentBody = updatedBody;
                    reviseSpinner.stop('Revision complete');

                    // Display the updated message and body
                    promptUI.log.step('Updated commit message:');
                    promptUI.log.message(green(updatedMessage));

                    if (updatedBody) {
                        promptUI.log.step('Updated commit body:');
                        promptUI.log.message(updatedBody);
                    }
                },
            });
        } else if (confirmed === 'edit') {
            const initial = `${currentMessage}\n\n${currentBody}`.trim();
            const edited = openInEditor(initial, promptUI);
            if (edited === null) {
                promptUI.outro('Commit cancelled');
                return { accepted: false };
            }
            // Split edited message into subject and body (first line = subject, rest = body)
            const [firstLine, ...rest] = edited.split('\n');
            currentMessage = firstLine.trim();
            currentBody = rest.join('\n').trim();
        }
    }
    promptUI.outro('Too many revisions requested, commit cancelled.');
    return { accepted: false };
};

export const agentStreamingReviewAndRevise = async ({
    aiAgentService,
    promptUI,
    message,
    body,
}: {
    aiAgentService: AIAgentService;
    promptUI: ClackPromptService;
    message: string;
    body: string;
}): Promise<{ accepted: boolean; message?: string; body?: string }> => {
    let currentMessage = message;
    let currentBody = body;

    for (let i = 0; i < 10; i++) {
        const confirmed = await promptUI.select({
            message: `Proposed commit message:\n\n${cyan(
                currentMessage,
            )}\n\n${cyan(currentBody)}\n\nWhat would you like to do?`,
            options: [
                { label: 'Accept and commit', value: 'accept' },
                { label: 'Revise with AI agent', value: 'revise' },
                { label: 'Edit in $EDITOR', value: 'edit' },
                { label: 'Cancel', value: 'cancel' },
            ],
        });

        if (confirmed === 'accept') {
            return { accepted: true, message: currentMessage, body: currentBody };
        } else if (confirmed === 'cancel' || promptUI.isCancel(confirmed)) {
            promptUI.outro('Commit cancelled');
            return { accepted: false };
        } else if (confirmed === 'revise') {
            const userPrompt = await promptUI.text({
                message:
                    'Describe how you want the AI agent to revise the commit message (e.g. "make it more descriptive", "use imperative mood", "check related files for context"):',
                placeholder: 'Enter revision prompt for the AI agent',
            });
            if (!userPrompt || promptUI.isCancel(userPrompt)) {
                promptUI.outro('Commit cancelled');
                return { accepted: false };
            }

            const reviseSpinner = promptUI.spinner();
            reviseSpinner.start('AI agent is revising your commit message...');

            try {
                const result = await aiAgentService.reviseCommitWithAgent({
                    currentMessage,
                    currentBody,
                    userRevisionPrompt: userPrompt,
                });

                reviseSpinner.stop('Agent revision complete');

                currentMessage = result.commitMessage;
                currentBody = result.body;

                // Display the updated message and body
                promptUI.log.step('Agent-revised commit message:');
                promptUI.log.message(green(result.commitMessage));

                if (result.body) {
                    promptUI.log.step('Agent-revised commit body:');
                    promptUI.log.message(result.body);
                }
            } catch (error) {
                reviseSpinner.stop('Agent revision failed');
                promptUI.outro(
                    `Failed to revise with agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
                return { accepted: false };
            }
        } else if (confirmed === 'edit') {
            const initial = `${currentMessage}\n\n${currentBody}`.trim();
            const edited = openInEditor(initial, promptUI);
            if (edited === null) {
                promptUI.outro('Commit cancelled');
                return { accepted: false };
            }
            // Split edited message into subject and body (first line = subject, rest = body)
            const [firstLine, ...rest] = edited.split('\n');
            currentMessage = firstLine.trim();
            currentBody = rest.join('\n').trim();
        }
    }
    promptUI.outro('Too many revisions requested, commit cancelled.');
    return { accepted: false };
};
