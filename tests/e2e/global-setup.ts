import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Builds the real CLI so the e2e suite never tests a stale `dist/cli.mjs`, then
 * verifies this environment allows loopback TCP connects. OS-level sandboxes
 * (e.g. nono/Seatbelt) can block child-process connects while allowing binds;
 * without this check the suite would fail later on CLI-behavior assertions
 * (empty stdout, zero wire requests) with the real cause — EPERM — nowhere in
 * sight. Fails loudly in both cases.
 */
export default async function globalSetup(): Promise<void> {
    const result = spawnSync('npm', ['run', 'build'], {
        cwd: repoRoot,
        stdio: 'inherit',
    });
    if (result.error !== undefined || result.status !== 0) {
        throw new Error(
            `E2E global setup: 'npm run build' failed with status ${result.status}: ${
                result.error?.message ?? 'see the build output above'
            }`,
        );
    }

    const server = createServer((_request, response) => {
        response.end('ok');
    });
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
        server.close();
        throw new Error('E2E global setup: loopback server did not report a TCP address');
    }
    try {
        await fetch(`http://127.0.0.1:${address.port}/`);
    } catch (error) {
        const cause = (error as Error & { cause?: Error }).cause?.message ?? (error as Error).message;
        throw new Error(
            `E2E global setup: this environment blocks loopback TCP connects (${cause}); ` +
                'the e2e suite needs the CLI child process to reach the in-process stub. ' +
                'Run it outside OS-level sandboxing.',
            { cause: error },
        );
    } finally {
        server.closeIdleConnections();
        server.close();
    }
}
