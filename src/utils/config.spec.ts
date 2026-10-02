import { describe, expect, it } from 'vitest';
import { profileConfigSchema } from './config';

describe('profileConfigSchema', () => {
    describe('reasoningEffort', () => {
        it.each([
            ['openai', 'https://api.openai.com/v1', 'high'],
            ['openai', 'https://api.openai.com/v1', ''],
            ['openrouter', 'https://openrouter.ai/api/v1', 'low'],
            ['openrouter', 'https://openrouter.ai/api/v1', ''],
        ])('accepts %s with reasoningEffort %j', (provider, baseUrl, reasoningEffort) => {
            expect(profileConfigSchema.safeParse({ provider, baseUrl, model: 'x', reasoningEffort }).success).toBe(
                true,
            );
        });

        it('rejects an invalid reasoningEffort', () => {
            const result = profileConfigSchema.safeParse({
                provider: 'openai',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-5',
                reasoningEffort: 'ultra',
            });

            expect(result.success).toBe(false);
        });
    });

    it('still parses profiles saved with the retired stageAll setting, and drops it', () => {
        const result = profileConfigSchema.safeParse({
            provider: 'ollama',
            model: 'llama3',
            stageAll: true,
        });

        expect(result.success).toBe(true);
        expect(result.data).not.toHaveProperty('stageAll');
    });
});
