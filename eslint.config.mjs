import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist/**'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            curly: ['error', 'all'],
            eqeqeq: 'error',
            quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: false }],
            yoda: 'error',

            'no-nested-ternary': 'error',
            'object-shorthand': 'error',

            '@typescript-eslint/array-type': ['error', { default: 'array' }],
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            'no-unused-vars': 'off', // Turn off the base rule as it can report incorrect errors
        },
    },
);
