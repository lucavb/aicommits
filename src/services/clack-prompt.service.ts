import { intro, outro, note, log, spinner, select, text, cancel, isCancel, confirm } from '@clack/prompts';
import { Injectable } from '../utils/inversify';

@Injectable()
export class ClackPromptService {
    // Direct exposure of @clack/prompts functions - no abstraction layer
    readonly cancel = cancel;
    readonly confirm = confirm;
    readonly intro = intro;
    readonly isCancel = isCancel;
    readonly log = log;
    readonly note = note;
    readonly outro = outro;
    readonly select = select;
    readonly spinner = spinner;
    readonly text = text;
}
