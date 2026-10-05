import path from 'node:path';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(import.meta.dirname);

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/e2e/**/*.spec.ts'],
        exclude: ['**/node_modules/**'],
        globals: true,
        testTimeout: 30000,
        hookTimeout: 60000,
        globalSetup: [path.join(repoRoot, 'tests/e2e/global-setup.ts')],
    },
});
