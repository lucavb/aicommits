import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './env';

describe('parseEnvironment', () => {
    it('should parse known environment variables', () => {
        const env = parseEnvironment({
            HOME: '/home/user',
            AIC_PROFILE: 'work',
            OPENAI_API_KEY: 'sk-openai',
            ANTHROPIC_API_KEY: 'sk-ant',
            OPENROUTER_API_KEY: 'sk-or',
            AIC_API_KEY: 'sk-generic',
        });

        expect(env.HOME).toBe('/home/user');
        expect(env.AIC_PROFILE).toBe('work');
        expect(env.OPENAI_API_KEY).toBe('sk-openai');
        expect(env.ANTHROPIC_API_KEY).toBe('sk-ant');
        expect(env.OPENROUTER_API_KEY).toBe('sk-or');
        expect(env.AIC_API_KEY).toBe('sk-generic');
    });

    it('should treat empty strings as undefined', () => {
        const env = parseEnvironment({
            AIC_PROFILE: '',
            OPENAI_API_KEY: '   ',
        });

        expect(env.AIC_PROFILE).toBeUndefined();
        expect(env.OPENAI_API_KEY).toBeUndefined();
    });

    it('should trim whitespace from values', () => {
        const env = parseEnvironment({
            OPENAI_API_KEY: '  sk-test  ',
        });

        expect(env.OPENAI_API_KEY).toBe('sk-test');
    });

    it('should capture dynamic profile api key env vars via catchall', () => {
        const env = parseEnvironment({
            AIC_API_KEY_WORK: 'sk-work',
            AIC_API_KEY_MY_PROJECT: 'sk-project',
        });

        expect(env.AIC_API_KEY_WORK).toBe('sk-work');
        expect(env.AIC_API_KEY_MY_PROJECT).toBe('sk-project');
    });
});
