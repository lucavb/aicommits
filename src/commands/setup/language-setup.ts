import { text } from '@clack/prompts';
import { type ProfileConfig } from '../../utils/config';
import type { LanguageCode } from 'iso-639-1';
import iso6391 from 'iso-639-1';

/**
 * Check if a string is a valid ISO language code
 */
export const isLanguageCode = (value: string): value is LanguageCode => {
    return value.length === 2 && iso6391.validate(value);
};

/**
 * Detect the system locale from environment variables
 */
export const detectLocale = (): LanguageCode => {
    // Try to get locale from environment variables in order of preference
    const localeVars = ['LC_ALL', 'LANG', 'LANGUAGE'];
    for (const varName of localeVars) {
        const value = process.env[varName];
        if (value) {
            // Extract the language code (e.g., "en_US.UTF-8" -> "en")
            const langCode = value.split('_')[0].toLowerCase();
            if (isLanguageCode(langCode)) {
                return langCode;
            }
        }
    }
    return 'en'; // Default to English if no locale is detected
};

/**
 * Setup the language preference
 */
export async function setupLanguage(currentConfig?: ProfileConfig): Promise<LanguageCode | null> {
    const detectedLocale = detectLocale();
    const locale = await text({
        message: 'Enter your preferred language code (e.g., en, es, fr)',
        placeholder: detectedLocale,
        initialValue: currentConfig?.locale || detectedLocale,
        validate: (value) => {
            if (!value) {
                return 'Language code is required';
            }
            if (value.length !== 2) {
                return 'Language code must be 2 characters';
            }
            if (!isLanguageCode(value)) {
                return 'Invalid language code. Please use a valid ISO 639-1 code (e.g., en, es, fr)';
            }
            return undefined;
        },
    });

    if (locale === null) {
        return null;
    }

    if (typeof locale !== 'string') {
        throw new Error('Language code is required');
    }

    return locale as LanguageCode;
}
