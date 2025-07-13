import { type ProfileConfig } from '../../utils/config';

/**
 * This function is deprecated as the AI now determines commit message format automatically.
 * Kept for backward compatibility but returns null.
 */
export async function setupCommitFormat(_currentConfig?: ProfileConfig): Promise<null> {
    return null;
}
