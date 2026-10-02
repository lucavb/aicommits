import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        setupFiles: ['./setup-vitest.ts'],
        include: ['**/*.spec.ts'],
        // `.slim/` holds environment-owned worktree copies of this repo; their
        // duplicate specs would race the real ones on shared /tmp fixtures.
        exclude: [...configDefaults.exclude, '**/.slim/**'],
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
        },
    },
});
