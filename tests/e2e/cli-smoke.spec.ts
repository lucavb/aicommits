import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestEnv, startStubServer, type StubServer, type TestEnv } from './helpers';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string };

const stub: StubServer = await startStubServer();
const env: TestEnv = await createTestEnv(stub);

afterAll(async () => {
    await stub.close().catch(() => undefined);
    env.cleanup();
});

describe('CLI smoke', () => {
    it('--help prints usage and exits zero', async () => {
        const result = await env.run(['--help']);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Usage');
    });

    it('version prints the package version and exits zero', async () => {
        const result = await env.run(['version']);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(packageJson.version);
    });

    // Empirically observed while building this suite: with stdin ignored and
    // no TTY, the default (interactive) command does not exit — a probe run
    // hung until its 15s execa timeout killed it (this config's testTimeout
    // is 30s). It needs a clean non-TTY guard before this can be asserted as
    // a contract.
    it.todo('default command should fail cleanly without a TTY instead of hanging');
});
