import { intro, outro, note, log, spinner, select, text, cancel, isCancel } from '@clack/prompts';
import { Injectable } from '../utils/inversify';

@Injectable()
export class ClackPromptService {
    // Direct exposure of @clack/prompts functions - no abstraction layer
    readonly intro = intro;
    readonly outro = outro;
    readonly note = note;
    readonly spinner = spinner;
    readonly log = log;
    readonly select = select;
    readonly text = text;
    readonly cancel = cancel;
    readonly isCancel = isCancel;
}
