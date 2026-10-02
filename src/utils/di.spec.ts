import { describe, expect, it } from 'vitest';
import type { ServiceIdentifier } from 'inversify';
import { buildContainer } from './di';
import { parseEnvironment } from './env';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { type FileSystemApi, ProfileStore } from '../profile/profile-store';
import { READY_PROFILE, RESOLVED_PROFILE, type ReadyProfileAccessor } from '../profile/resolved-profile';
import { GitService } from '../services/git.service';
import { PromptService } from '../services/prompt.service';
import { ClackPromptService } from '../services/clack-prompt.service';
import { ClackReviewPrompt } from '../services/clack-review-prompt';
import { REVIEW_PROMPT } from '../services/review-prompt.interface';
import { ProposalService } from '../services/proposal.service';
import { AIProviderFactory } from '../services/ai-provider.factory';
import { AITextGenerationService } from '../services/ai-text-generation.service';
import { AiCommitsHandler } from '../handlers/aicommits.handler';
import { PrepareCommitMsgHandler } from '../handlers/prepare-commit-msg.handler';
import { ConfigSetHandler } from '../handlers/config-set.handler';
import { SetupHandler } from '../handlers/setup.handler';
import { IgnoreHandler } from '../handlers/ignore.handler';

/**
 * `container.get(X)` type-checks even when nothing binds X - Inversify only
 * fails at runtime, once that line actually executes. Each command previously
 * bound its own handler ad hoc, and forgetting to do so (as happened once)
 * wasn't caught by type-check, lint, or any other test - only by running the
 * built CLI binary by hand. `buildContainer` now binds every resolvable class
 * up front, and this test resolves each of them through the real composition
 * root to make sure that never regresses silently again.
 */
describe('buildContainer', () => {
    const resolvableClasses: { name: string; identifier: ServiceIdentifier<unknown> }[] = [
        AICommitMessageService,
        ProfileStore,
        GitService,
        PromptService,
        ClackPromptService,
        ClackReviewPrompt,
        ProposalService,
        AIProviderFactory,
        AITextGenerationService,
        AiCommitsHandler,
        PrepareCommitMsgHandler,
        ConfigSetHandler,
        SetupHandler,
        IgnoreHandler,
        REVIEW_PROMPT,
        RESOLVED_PROFILE,
        READY_PROFILE,
    ].map((identifier) => ({
        name: typeof identifier === 'symbol' ? identifier.toString() : identifier.name,
        identifier,
    }));

    it.each(resolvableClasses)('resolves $name without throwing', async ({ identifier }) => {
        const container = await buildContainer({
            environment: parseEnvironment({}),
            // Cast once (the literal cannot be compared against the
            // overloaded Promise<Buffer> reading of the real fs API); a
            // genuinely missing file is the only read failure that may
            // default, so the ENOENT code must be present.
            fileSystem: {
                readFile: async () => {
                    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
                },
                writeFile: async () => undefined,
                // ProfileStore#save persists the credential file atomically
                // (temp file + rename) with explicit owner-only mode, so the
                // file system API contract now also carries rename and chmod.
                rename: async () => undefined,
                chmod: async () => undefined,
            } as unknown as FileSystemApi,
        });

        expect(() => container.get(identifier)).not.toThrow();
    });

    it('reads the config file once and binds the resolved profile for the run', async () => {
        let reads = 0;
        const container = await buildContainer({
            cliArguments: { profile: 'work', model: 'gpt-5' },
            environment: parseEnvironment({ OPENAI_API_KEY: 'sk-env' }),
            fileSystem: {
                readFile: async () => {
                    reads++;
                    return 'profiles:\n  work:\n    provider: openai\n    model: gpt-4\n    baseUrl: https://api.openai.com/v1\n';
                },
                writeFile: async () => undefined,
            } as unknown as FileSystemApi,
        });

        expect(reads).toBe(1);
        expect(container.get(RESOLVED_PROFILE)).toMatchObject({
            status: 'ready',
            name: 'work',
            settings: { model: 'gpt-5' },
            credential: { source: { kind: 'environment', variable: 'OPENAI_API_KEY' } },
        });
        expect(container.get<ReadyProfileAccessor>(READY_PROFILE)().name).toBe('work');
    });
});
