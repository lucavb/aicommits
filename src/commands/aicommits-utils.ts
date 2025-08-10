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

interface RevisionConfig {
    reviseLabel: string;
    promptMessage: string;
    promptPlaceholder: string;
    revise: (
        userPrompt: string,
        currentMessage: string,
        currentBody: string,
    ) => Promise<{ message: string; body: string }>;
}

const reviewAndRevise = async (
    promptUI: ClackPromptService,
    message: string,
    body: string,
    config: RevisionConfig,
): Promise<{ accepted: boolean; message?: string; body?: string }> => {
    let currentMessage = message;
    let currentBody = body;

    for (let i = 0; i < 10; i++) {
        const confirmed = await promptUI.select({
            message: `Proposed commit message:\n\n${cyan(
                currentMessage,
            )}\n\n${cyan(currentBody)}\n\nWhat would you like to do?`,
            options: [
                { label: 'Accept and commit', value: 'accept' },
                { label: config.reviseLabel, value: 'revise' },
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
                message: config.promptMessage,
                placeholder: config.promptPlaceholder,
            });
            if (!userPrompt || promptUI.isCancel(userPrompt)) {
                promptUI.outro('Commit cancelled');
                return { accepted: false };
            }

            try {
                const result = await config.revise(userPrompt, currentMessage, currentBody);
                currentMessage = result.message;
                currentBody = result.body;
            } catch (error) {
                promptUI.outro(`Failed to revise: ${error instanceof Error ? error.message : 'Unknown error'}`);
                return { accepted: false };
            }
        } else if (confirmed === 'edit') {
            const result = handleEditorRevision(promptUI, currentMessage, currentBody);
            if (!result) {
                return { accepted: false };
            }
            currentMessage = result.message;
            currentBody = result.body;
        }
    }
    promptUI.outro('Too many revisions requested, commit cancelled.');
    return { accepted: false };
};

const handleEditorRevision = (
    promptUI: ClackPromptService,
    currentMessage: string,
    currentBody: string,
): { message: string; body: string } | null => {
    const initial = `${currentMessage}\n\n${currentBody}`.trim();
    const edited = openInEditor(initial, promptUI);
    if (edited === null) {
        promptUI.outro('Commit cancelled');
        return null;
    }
    // Split edited message into subject and body (first line = subject, rest = body)
    const [firstLine, ...rest] = edited.split('\n');
    return {
        message: firstLine.trim(),
        body: rest.join('\n').trim(),
    };
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
    const config: RevisionConfig = {
        reviseLabel: 'Revise with a prompt',
        promptMessage:
            'Describe how you want to revise the commit message (e.g. "make it more descriptive", "use imperative mood", etc):',
        promptPlaceholder: 'Enter revision prompt',
        revise: async (userPrompt: string) => {
            const reviseSpinner = promptUI.spinner();
            reviseSpinner.start('The AI is revising your commit message');

            let messageBuffer = '';
            let updatedMessage = '';
            let updatedBody = '';

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
                onComplete: (message, body) => {
                    updatedMessage = message;
                    updatedBody = body;
                    reviseSpinner.stop('Revision complete');

                    // Display the updated message and body
                    promptUI.log.step('Updated commit message:');
                    promptUI.log.message(green(message));

                    if (body) {
                        promptUI.log.step('Updated commit body:');
                        promptUI.log.message(body);
                    }
                },
            });

            return { message: updatedMessage, body: updatedBody };
        },
    };

    return reviewAndRevise(promptUI, message, body, config);
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
    const config: RevisionConfig = {
        reviseLabel: 'Revise with AI agent',
        promptMessage:
            'Describe how you want the AI agent to revise the commit message (e.g. "make it more descriptive", "use imperative mood", "check related files for context"):',
        promptPlaceholder: 'Enter revision prompt for the AI agent',
        revise: async (userPrompt: string, currentMessage: string, currentBody: string) => {
            const reviseSpinner = promptUI.spinner();
            reviseSpinner.start('AI agent is revising your commit message...');

            const result = await aiAgentService.reviseCommitWithAgent({
                currentMessage,
                currentBody,
                userRevisionPrompt: userPrompt,
                onToolCall: (message: string) => {
                    reviseSpinner.message(`AI agent: ${message}`);
                },
            });

            reviseSpinner.stop('Agent revision complete');

            // Display the updated message and body
            promptUI.log.step('Agent-revised commit message:');
            promptUI.log.message(green(result.commitMessage));

            if (result.body) {
                promptUI.log.step('Agent-revised commit body:');
                promptUI.log.message(result.body);
            }

            return { message: result.commitMessage, body: result.body };
        },
    };

    return reviewAndRevise(promptUI, message, body, config);
};
