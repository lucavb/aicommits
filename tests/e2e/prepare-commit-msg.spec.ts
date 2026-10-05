import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { createTestEnv, STUB_BODY, STUB_MODEL, STUB_SUBJECT, startStubServer } from './helpers';

it('prepare-commit-msg prints subject and body, sends the diff to the stub, and commits nothing', async () => {
    const stub = await startStubServer();
    const env = await createTestEnv(stub);

    try {
        const result = await env.run(['prepare-commit-msg']);

        expect(result.exitCode).toBe(0);
        // The hook consumes stdout as the commit message, so pin it byte-exact
        // (NO_COLOR is set and the stub text is static): any leaked banner,
        // spinner frame, or duplicated output must fail the suite.
        expect(result.stdout.trim()).toBe(`${STUB_SUBJECT}\n\n${STUB_BODY}`);
        expect(stub.requests).toHaveLength(2);
        expect(stub.requests.every((request) => request.raw.includes(env.marker))).toBe(true);
        expect(stub.requests.every((request) => request.model === STUB_MODEL)).toBe(true);
        expect(stub.requests.every((request) => request.url === '/v1/chat/completions')).toBe(true);

        const headCount = spawnSync('git', ['rev-list', '--count', 'HEAD'], {
            cwd: env.repoDir,
            encoding: 'utf8',
        });
        expect(headCount.status).toBe(0);
        expect(Number.parseInt(headCount.stdout, 10)).toBe(1);
    } finally {
        await stub.close().catch(() => undefined);
        env.cleanup();
    }
});

it('prepare-commit-msg stays silent when nothing is staged', async () => {
    const stub = await startStubServer();
    const env = await createTestEnv(stub);

    try {
        env.git(['restore', '--staged', '.']);

        const result = await env.run(['prepare-commit-msg']);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
        expect(stub.requests).toHaveLength(0);
    } finally {
        await stub.close().catch(() => undefined);
        env.cleanup();
    }
});

it('prepare-commit-msg warns and exits zero without a profile config file', async () => {
    const stub = await startStubServer();
    const env = await createTestEnv(stub, { withConfig: false });

    try {
        const result = await env.run(['prepare-commit-msg']);

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toContain('aicommits:');
        expect(result.stderr.toLowerCase()).toContain("haven't set up");
        expect(stub.requests).toHaveLength(0);
    } finally {
        await stub.close().catch(() => undefined);
        env.cleanup();
    }
});

it('prepare-commit-msg warns and exits zero without an API key', async () => {
    const stub = await startStubServer();
    const env = await createTestEnv(stub);

    try {
        // Derive from the canonical child env (minus the API key) so this test
        // cannot silently drift when the default env grows.
        const { OPENAI_API_KEY: _omitted, ...childEnvWithoutKey } = env.childEnv;
        const result = await env.run(['prepare-commit-msg'], { env: childEnvWithoutKey });

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toContain('aicommits:');
        expect(result.stderr).toContain('OPENAI_API_KEY');
        expect(stub.requests).toHaveLength(0);
    } finally {
        await stub.close().catch(() => undefined);
        env.cleanup();
    }
});

it('prepare-commit-msg warns and exits zero when the stub responds with HTTP 500', async () => {
    const stub = await startStubServer({ mode: 'fail500' });
    const env = await createTestEnv(stub);

    try {
        const result = await env.run(['prepare-commit-msg']);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('generation failed');
        // Each generation retries 3 times against the failing stub (subject and
        // body), so the exact count is a retry-policy detail; this test's
        // contract is that the CLI reached the API for both of them.
        expect(stub.requests.length).toBeGreaterThanOrEqual(2);
    } finally {
        await stub.close().catch(() => undefined);
        env.cleanup();
    }
});

it('prepare-commit-msg rejects unknown options with exit code 1', async () => {
    const stub = await startStubServer();
    const env = await createTestEnv(stub);

    try {
        const result = await env.run(['prepare-commit-msg', '--base-url', 'x']);

        expect(result.exitCode).toBe(1);
        expect(result.stderr.toLowerCase()).toContain('unknown option');
    } finally {
        await stub.close().catch(() => undefined);
        env.cleanup();
    }
});
