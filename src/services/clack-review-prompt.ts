import { isCancel, log, outro, select, spinner, text } from '@clack/prompts';
import { cyan, green } from 'kolorist';
import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { Injectable } from '../utils/inversify';
import type { ReviewPrompt } from './review-prompt.interface';

/**
 * Clack-backed adapter for the ReviewPrompt seam. Backs every operation with
 * @clack/prompts functions directly - it is standalone and does not go through
 * ClackPromptService.
 */
@Injectable()
export class ClackReviewPrompt implements ReviewPrompt {
    private spinner: ReturnType<typeof spinner> | undefined;
    async askChoice(subject: string, body: string): Promise<'accept' | 'revise' | 'edit' | 'cancel'> {
        const confirmed = await select({
            message: `Proposed commit message:\n\n${cyan(subject)}\n\n${cyan(body)}\n\nWhat would you like to do?`,
            options: [
                { label: 'Accept and commit', value: 'accept' as const },
                { label: 'Revise with a prompt', value: 'revise' as const },
                { label: 'Edit in $EDITOR', value: 'edit' as const },
                { label: 'Cancel', value: 'cancel' as const },
            ],
        });

        if (isCancel(confirmed)) {
            return 'cancel';
        }

        return confirmed;
    }

    async askRevisionPrompt(): Promise<string | null> {
        const userPrompt = await text({
            message:
                'Describe how you want to revise the commit message (e.g. "make it more descriptive", "use imperative mood", etc):',
            placeholder: 'Enter revision prompt',
        });
        if (!userPrompt || isCancel(userPrompt)) {
            return null;
        }
        return userPrompt;
    }

    startProgress(message: string): void {
        this.spinner = spinner();
        this.spinner.start(message);
    }

    updateProgress(message: string): void {
        this.spinner?.message(message);
    }

    stopProgress(message: string): void {
        this.spinner?.stop(message);
        this.spinner = undefined;
    }

    showProposal(subjectTitle: string, bodyTitle: string, subject: string, body: string): void {
        log.step(subjectTitle);
        log.message(green(subject));

        if (body) {
            log.step(bodyTitle);
            log.message(body);
        }
    }

    announce(message: string): void {
        outro(message);
    }

    editInEditor(initialContent: string): string | null {
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
    }
}
