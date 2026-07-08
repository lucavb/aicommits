import { Container } from 'inversify';
import simpleGit, { type SimpleGit } from 'simple-git';
import { promises as fs } from 'fs';
import { AICommitMessageService } from '../services/ai-commit-message.service';
import {
    CLI_ARGUMENTS,
    CONFIG_FILE_PATH,
    ConfigService,
    ENVIRONMENT_VARIABLES,
    FILE_SYSTEM_PROMISE_API,
    type CliArguments,
    type FileSystemApi,
} from '../services/config.service';
import { GitService, SIMPLE_GIT } from '../services/git.service';
import { PromptService } from '../services/prompt.service';
import { ClackPromptService } from '../services/clack-prompt.service';
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
 * Must be called once all runtime inputs (parsed CLI args, env, etc.) are known,
 * so every binding below is guaranteed to exist before any service resolves it.
 *
 * Every resolvable class - services and command handlers alike - is bound here,
 * so `container.get(X)` can never fail because a caller forgot to bind X. Binding
 * a class is free until something actually resolves it (Inversify only
 * instantiates on `.get()`), so there's no cost to registering handlers that a
 * given invocation never uses.
 */
export const buildContainer = (options: ContainerOptions = {}): Container => {
    const container = new Container({ defaultScope: 'Singleton' });

    container.bind(AICommitMessageService).toSelf();
    container.bind(ConfigService).toSelf();
    container.bind(GitService).toSelf();
    container.bind(PromptService).toSelf();
    container.bind(ClackPromptService).toSelf();
    container.bind(AIProviderFactory).toSelf();
    container.bind(AITextGenerationService).toSelf();

    container.bind(AiCommitsHandler).toSelf();
    container.bind(PrepareCommitMsgHandler).toSelf();
    container.bind(ConfigSetHandler).toSelf();
    container.bind(SetupHandler).toSelf();
    container.bind(IgnoreHandler).toSelf();

    container.bind(CLI_ARGUMENTS).toConstantValue(options.cliArguments ?? {});
    container.bind(ENVIRONMENT_VARIABLES).toConstantValue(options.environment ?? parseEnvironment(process.env));
    container.bind(FILE_SYSTEM_PROMISE_API).toConstantValue(options.fileSystem ?? fs);
    container.bind(SIMPLE_GIT).toConstantValue(options.git ?? simpleGit());

    if (options.configFilePath) {
        container.bind(CONFIG_FILE_PATH).toConstantValue(options.configFilePath);
    }

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
): Promise<T> => {
    const container = buildContainer(options);
    return callback(container);
};
