import { intro, outro, note, spinner, select, text, isCancel, confirm } from '@clack/prompts';
import { Injectable } from '../utils/inversify';

@Injectable()
export class ClackPromptService {
    // Direct exposure of @clack/prompts functions - no abstraction layer
    readonly confirm = confirm;
    readonly intro = intro;
    readonly isCancel = isCancel;
    readonly note = note;
    readonly outro = outro;
    readonly select = select;
    readonly spinner = spinner;
    readonly text = text;
}
