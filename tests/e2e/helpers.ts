import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa, type Options as ExecaOptions } from 'execa';
import { stringify as yamlStringify } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = path.join(repoRoot, 'dist', 'cli.mjs');

export const STUB_MODEL = 'gpt-4o-mini';
export const STUB_SUBJECT = 'e2e: add the diff marker';
export const STUB_BODY = '* add the E2E diff marker to the test file';

export type StubRequest = {
    url: string;
    /** The `model` field of the parsed request body. */
    model: string;
    /** Content of the request's `role: 'system'` message (JSON-stringified if not a string). */
    system: string;
    /** Full request body JSON string, for robust marker search. */
    raw: string;
};

export type StubMode = 'ok' | 'fail500';

export interface StubServer {
    url: string;
    requests: StubRequest[];
    close(): Promise<void>;
}

const sseChunk = (model: string, text: string): string =>
    `data: ${JSON.stringify({
        id: 'chatcmpl-stub',
        object: 'chat.completion.chunk',
        created: 0,
        model,
        choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    })}\n\n`;

const sseFinishChunk = (model: string): string =>
    `data: ${JSON.stringify({
        id: 'chatcmpl-stub',
        object: 'chat.completion.chunk',
        created: 0,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`;

const readBody = (request: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
        let body = '';
        request.on('data', (part: Buffer) => {
            body += part.toString('utf8');
        });
        request.on('end', () => {
            resolve(body);
        });
        request.on('error', reject);
    });

const respondSse = (response: ServerResponse, model: string, text: string): void => {
    response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    });
    response.write(sseChunk(model, text));
    response.write(sseFinishChunk(model));
    response.end('data: [DONE]\n\n');
};

/**
 * OpenAI-compatible SSE stub. Records every request in every mode (including
 * fail500 responses); returns canned subject text or body text depending on
 * the system prompt ("commit body" is the body-prompt marker, see
 * src/services/prompt.service.ts).
 */
export async function startStubServer({ mode = 'ok' }: { mode?: StubMode } = {}): Promise<StubServer> {
    const requests: StubRequest[] = [];
    const currentMode = mode;

    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
        const raw = await readBody(request);

        const parsed: { url: string; model: string; system: string } = {
            url: request.url ?? '',
            model: '',
            system: '',
        };
        try {
            const body = JSON.parse(raw) as {
                model?: string;
                messages?: { role: string; content: unknown }[];
            };
            const systemMessage = body.messages?.find((message) => message.role === 'system');
            if (systemMessage !== undefined) {
                parsed.system =
                    typeof systemMessage.content === 'string'
                        ? systemMessage.content
                        : JSON.stringify(systemMessage.content);
            }
            parsed.model = body.model ?? '';
        } catch {
            // Keep the zero-value parsed entry for an unparseable body.
        }
        requests.push({ ...parsed, raw });

        if (currentMode === 'fail500') {
            response.writeHead(500, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'e2e stub failure mode' } }));
            return;
        }

        const text = parsed.system.includes('commit body') ? STUB_BODY : STUB_SUBJECT;
        respondSse(response, parsed.model, text);
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve();
        });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Stub server did not report a TCP address');
    }
    const url = `http://127.0.0.1:${address.port}`;

    return {
        url,
        requests,
        close(): Promise<void> {
            return new Promise((resolve, reject) => {
                server.close((error: unknown) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
                // Streams may hold idle keep-alive connections open; do not wait for them.
                server.closeIdleConnections?.();
            });
        },
    };
}

/**
 * The execa result shape the tests rely on. execa's exported `Result` type is
 * generic over its options union, so `stdout`/`stderr` arrive as broad unions;
 * this env always runs in default text mode, so they are narrowed to strings.
 */
export type RunResult = Omit<Awaited<ReturnType<typeof execa>>, 'stdout' | 'stderr' | 'all'> & {
    stdout: string;
    stderr: string;
};

export interface TestEnv {
    /** Temporary directory standing in for the user's HOME. */
    home: string;
    /** Temporary git repository with a staged one-file change. */
    repoDir: string;
    /** Unique string written into the staged file; appears in the diff sent to the stub. */
    marker: string;
    stub: StubServer;
    /** The default child-process env run() passes (HOME isolated, key set). */
    readonly childEnv: NodeJS.ProcessEnv;
    /** Runs git in the fixture repo; throws on failure. */
    git(args: string[]): void;
    /** Runs the built CLI with HOME and env fixed to the test values. */
    run(args: readonly string[], options?: ExecaOptions): Promise<RunResult>;
    cleanup(): void;
}

type SpawnGit = (args: string[]) => void;

const spawnGit =
    (repoDir: string): SpawnGit =>
    (args) => {
        const result = spawnSync('git', args, {
            cwd: repoDir,
            encoding: 'utf8',
            // Fixture git must not read the developer's global config: a global
            // core.hooksPath (plausible on a dev machine of this very CLI)
            // could run or hang fixture commits inside a timeout-less
            // spawnSync that vitest's testTimeout cannot interrupt.
            env: {
                ...process.env,
                GIT_CONFIG_GLOBAL: '/dev/null',
                GIT_CONFIG_NOSYSTEM: '1',
            },
        });
        if (result.error !== undefined || result.status !== 0) {
            throw new Error(
                `e2e helper: git ${args.join(' ')} failed (status ${result.status}): ${
                    result.error?.message ?? result.stderr ?? 'no stderr'
                }`,
            );
        }
    };

const createProfileConfig = (home: string, stub: StubServer): void => {
    const profileConfig = {
        currentProfile: 'default',
        profiles: {
            default: {
                provider: 'openai',
                model: STUB_MODEL,
                baseUrl: `${stub.url}/v1`,
                type: 'conventional',
            },
        },
    };
    writeFileSync(path.join(home, '.aicommits.yaml'), yamlStringify(profileConfig), 'utf8');
};

type CreateTestEnvOptions = {
    /** Whether to write the profile config into the temp HOME (default true). */
    withConfig?: boolean;
};

/**
 * Builds a throwaway environment: a temp HOME with a profile config pointing
 * at the stub, and a git repo with one staged change.
 */
export async function createTestEnv(
    stub: StubServer,
    { withConfig = true }: CreateTestEnvOptions = {},
): Promise<TestEnv> {
    const home = mkdtempSync(path.join(os.tmpdir(), 'aicommits-e2e-home-'));
    const repoDir = mkdtempSync(path.join(os.tmpdir(), 'aicommits-e2e-repo-'));
    const git = spawnGit(repoDir);
    const marker = `E2E_DIFF_MARKER_${Math.random().toString(36).slice(2, 10)}`;

    try {
        if (withConfig) {
            createProfileConfig(home, stub);
        }
        git(['init', '-b', 'main']);
        git(['config', 'user.email', 'e2e@test.local']);
        git(['config', 'user.name', 'e2e']);
        git(['config', 'commit.gpgsign', 'false']);
        git(['config', 'core.autocrlf', 'false']);

        writeFileSync(path.join(repoDir, 'a.txt'), 'seed content\n', 'utf8');
        git(['add', 'a.txt']);
        git(['commit', '-m', 'e2e: seed commit']);

        writeFileSync(path.join(repoDir, 'a.txt'), `seed content\n${marker} = 1;\n`, 'utf8');
        git(['add', 'a.txt']);
    } catch (error) {
        // A half-built environment must not leak its temp dirs, and the spec's
        // `finally` never runs when createTestEnv itself throws — so close the
        // passed-in stub here too before rethrowing.
        rmSync(home, { recursive: true, force: true });
        rmSync(repoDir, { recursive: true, force: true });
        await stub.close().catch(() => undefined);
        throw error;
    }

    const childEnv: NodeJS.ProcessEnv = {
        PATH: process.env.PATH ?? '',
        HOME: home,
        USERPROFILE: home,
        OPENAI_API_KEY: 'test',
        NO_COLOR: '1',
    };

    const run = async (args: readonly string[], options: ExecaOptions = {}): Promise<RunResult> =>
        (await execa(process.execPath, [cliPath, ...args], {
            cwd: repoDir,
            env: childEnv,
            extendEnv: false,
            reject: false,
            // Hang-class failures must die here (SIGTERM, then SIGKILL) well
            // before vitest's testTimeout abandons the awaiting test and leaks
            // an orphaned child; 20s clears the ~6-8s retry-backoff floor of
            // the 500-path test. Per-call options can still override both.
            stdin: 'ignore',
            timeout: 20_000,
            ...options,
        })) as RunResult;

    return {
        home,
        repoDir,
        marker,
        stub,
        childEnv,
        git,
        run,
        cleanup(): void {
            for (const directory of [repoDir, home]) {
                rmSync(directory, { recursive: true, force: true });
            }
        },
    };
}
