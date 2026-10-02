import { Container } from 'inversify';
import { simpleGit, type SimpleGit } from 'simple-git';
import { promises as fs } from 'fs';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import {
    CLI_ARGUMENTS,
    ENVIRONMENT_VARIABLES,
    READY_PROFILE,
    RESOLVED_PROFILE,
    requireReady,
    resolveProfile,
    type CliArguments,
    type ReadyProfileAccessor,
    type ResolvedProfile,
} from '../profile/resolved-profile';
import { CONFIG_FILE_PATH, FILE_SYSTEM_PROMISE_API, ProfileStore, type FileSystemApi } from '../profile/profile-store';
import { GitService, SIMPLE_GIT } from '../services/git.service';
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
import { parseEnvironment, type Environment } from './env';

export interface ContainerOptions {
    cliArguments?: CliArguments;
    configFilePath?: string;
    environment?: Environment;
    fileSystem?: FileSystemApi;
    git?: SimpleGit;
}

/**
 * Composition root: the single place where the dependency graph is assembled.
 * Must be called once all runtime inputs (parsed CLI args, env, etc.) are known.
 *
 * The config file is read here, once, and the resolved profile for this run is
 * bound as an immutable value (see docs/adr/0002). Handlers inject
 * RESOLVED_PROFILE and decide what to do when it is missing or invalid; services
 * that only make sense with a usable profile inject READY_PROFILE, an accessor
 * that throws a KnownError otherwise.
 *
 * Every resolvable class is bound here, so `container.get(X)` can never fail
 * because a caller forgot to bind X. Inversify only instantiates on `.get()`.
 */
export const buildContainer = async (options: ContainerOptions = {}): Promise<Container> => {
    const container = new Container({ defaultScope: 'Singleton' });
    const cliArguments = options.cliArguments ?? {};
    const environment = options.environment ?? parseEnvironment(process.env);

    container.bind(CLI_ARGUMENTS).toConstantValue(cliArguments);
    container.bind(ENVIRONMENT_VARIABLES).toConstantValue(environment);
    container.bind(FILE_SYSTEM_PROMISE_API).toConstantValue(options.fileSystem ?? fs);
    container.bind(SIMPLE_GIT).toConstantValue(options.git ?? simpleGit());
    if (options.configFilePath) {
        container.bind(CONFIG_FILE_PATH).toConstantValue(options.configFilePath);
    }

    container.bind(ProfileStore).toSelf();
    const file = await container.get(ProfileStore).load();
    const resolved = resolveProfile({ file, cliArguments, env: environment });
    container.bind<ResolvedProfile>(RESOLVED_PROFILE).toConstantValue(resolved);
    container.bind<ReadyProfileAccessor>(READY_PROFILE).toConstantValue(() => requireReady(resolved));

    container.bind(AICommitMessageService).toSelf();
    container.bind(GitService).toSelf();
    container.bind(PromptService).toSelf();
    container.bind(ClackPromptService).toSelf();
    container.bind(ClackReviewPrompt).toSelf();
    container.bind(REVIEW_PROMPT).toDynamicValue((context) => context.get(ClackReviewPrompt));
    container.bind(ProposalService).toSelf();
    container.bind(AIProviderFactory).toSelf();
    container.bind(AITextGenerationService).toSelf();

    container.bind(AiCommitsHandler).toSelf();
    container.bind(PrepareCommitMsgHandler).toSelf();
    container.bind(ConfigSetHandler).toSelf();
    container.bind(SetupHandler).toSelf();
    container.bind(IgnoreHandler).toSelf();

    return container;
};

/**
 * Convenience wrapper for Commander actions: builds a fresh container for this
 * invocation and hands it to the caller, which resolves whichever handler it
 * needs via `container.get(SomeHandler)`.
 */
export const runWithContainer = async <T>(
    options: ContainerOptions,
    callback: (container: Container) => Promise<T> | T,
): Promise<T> => callback(await buildContainer(options));
