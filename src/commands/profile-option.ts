import { Option } from '@commander-js/extra-typings';

/**
 * Shared `--profile` flag. Deliberately has no Commander default: when omitted,
 * the profile falls back to AIC_PROFILE, then the config file's currentProfile,
 * then "default" (see resolveProfile).
 */
export const profileOption = () =>
    new Option(
        '--profile <profile>',
        'Configuration profile to use (defaults to AIC_PROFILE, then currentProfile, then "default")',
    );
