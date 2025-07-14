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
    stagedFiles: string[],
): Promise<{ accepted: boolean; message?: string; body?: string }> => {
    let currentMessage = message;
    let currentBody = body;

    while (true) {
        const action = await select({
            message: 'What would you like to do?',
            options: [
                { value: 'commit', label: 'Commit with this message' },
                { value: 'edit', label: 'Edit message manually' },
                { value: 'regenerate', label: 'Generate a new message with additional instructions' },
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
            const userInstructions = await text({
                message: 'What changes would you like to make to the commit message?',
                placeholder:
                    'e.g., "Make it more descriptive", "Use conventional commits format", "Focus on the performance improvements"',
                validate: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Please provide instructions for how to improve the commit message.';
                    }
                    return undefined;
                },
            });

            if (userInstructions && typeof userInstructions === 'string') {
                const regenerateSpinner = spinner();
                regenerateSpinner.start(
                    'The AI is analyzing your changes and generating a new commit message with your instructions',
                );

                try {
                    await aiCommitMessageService.generateAgentCommitMessageWithInstructions({
                        stagedFiles,
                        userInstructions: userInstructions.trim(),
                        onStepUpdate: (stepInfo) => {
                            if (stepInfo.type === 'tool-call') {
                                if (stepInfo.toolName === 'listStagedFiles') {
                                    regenerateSpinner.message('AI is listing staged files...');
                                } else if (stepInfo.toolName === 'getRecentCommitMessageExamples') {
                                    regenerateSpinner.message('AI is analyzing recent commit message styles...');
                                } else if (stepInfo.toolName === 'readStagedFile') {
                                    const fileName = stepInfo.args.filePath || 'file';
                                    regenerateSpinner.message(`AI is reading ${fileName}...`);
                                } else if (stepInfo.toolName === 'readStagedFileDiffs') {
                                    const fileCount = stepInfo.args.filePaths?.length || 0;
                                    regenerateSpinner.message(
                                        `AI is examining diffs for ${fileCount} file${fileCount !== 1 ? 's' : ''}...`,
                                    );
                                } else if (stepInfo.toolName === 'finishCommitMessage') {
                                    regenerateSpinner.message(
                                        'AI is finalizing the commit message with your instructions...',
                                    );
                                }
                            } else if (stepInfo.type === 'tool-result') {
                                if (stepInfo.toolName === 'readStagedFile') {
                                    if ('filePath' in stepInfo.result) {
                                        const fileName = stepInfo.result.filePath || 'file';
                                        regenerateSpinner.message(`AI analyzed ${fileName}`);
                                    }
                                } else if (stepInfo.toolName === 'readStagedFileDiffs') {
                                    if ('fileDiffs' in stepInfo.result) {
                                        const fileCount = stepInfo.result.fileDiffs?.length || 0;
                                        regenerateSpinner.message(
                                            `AI analyzed diffs for ${fileCount} file${fileCount !== 1 ? 's' : ''}`,
                                        );
                                    }
                                } else if (stepInfo.toolName === 'finishCommitMessage') {
                                    regenerateSpinner.message(
                                        'AI has generated the new commit message with your instructions',
                                    );
                                }
                            }
                        },
                        onComplete: (message, body) => {
                            currentMessage = message;
                            currentBody = body;
                        },
                    });

                    regenerateSpinner.stop('New commit message generated with your instructions');

                    log.step('New commit message:');
                    log.message(green(currentMessage));

                    if (currentBody) {
                        log.step('New commit body:');
                        log.message(currentBody);
                    }
                } catch (error) {
                    regenerateSpinner.stop('Failed to generate new message');
                    log.error(
                        `Failed to generate new commit message: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    );
                }
            }
        }
    }
};
