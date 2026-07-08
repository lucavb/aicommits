import { describe, expect, it } from 'vitest';
import type { ServiceIdentifier } from 'inversify';
import { buildContainer } from './di';
import { parseEnvironment } from './env';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import { ConfigService } from '../services/config.service';
import { GitService } from '../services/git.service';
import { PromptService } from '../services/prompt.service';
import { ClackPromptService } from '../services/clack-prompt.service';
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
        ConfigService,
        GitService,
        PromptService,
        ClackPromptService,
        AIProviderFactory,
        AITextGenerationService,
        AiCommitsHandler,
        PrepareCommitMsgHandler,
        ConfigSetHandler,
        SetupHandler,
        IgnoreHandler,
    ].map((identifier) => ({ name: identifier.name, identifier }));

    it.each(resolvableClasses)('resolves $name without throwing', ({ identifier }) => {
        const container = buildContainer({
            environment: parseEnvironment({}),
            fileSystem: {
                readFile: async () => {
                    throw new Error('missing');
                },
                writeFile: async () => undefined,
            },
        });

        expect(() => container.get(identifier)).not.toThrow();
    });
});
