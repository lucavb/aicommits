import { select } from '@clack/prompts';
import { type ProfileConfig } from '../../utils/config';

/**
 * Setup the commit message format
 */
export async function setupCommitFormat(currentConfig?: ProfileConfig): Promise<'conventional' | 'simple' | null> {
    const type = await select({
        message: 'Select commit message format',
        options: [
            { value: 'conventional', label: 'Conventional Commits (e.g., feat: add new feature)' },
            { value: 'simple', label: 'Simple (e.g., Add new feature)' },
        ],
        initialValue: currentConfig?.type === 'conventional' ? 'conventional' : 'simple',
    });

    if (type === null) {
        return null;
    }

    if (typeof type !== 'string' || (type !== 'conventional' && type !== 'simple')) {
        throw new Error('Invalid commit message type');
    }

    return type;
}
