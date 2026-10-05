import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        setupFiles: ['./setup-vitest.ts'],
        include: ['**/*.spec.ts'],
        // `.slim/` holds environment-owned worktree copies of this repo; their
        // duplicate specs would race the real ones on shared /tmp fixtures.
        // `tests/e2e/` runs only via vitest.e2e.config.ts (which builds the CLI
        // first); any new tests/<suite>/ with its own config must be excluded
        // here too, or the unit run picks up its specs without that setup.
        exclude: [...configDefaults.exclude, '**/.slim/**', 'tests/e2e/**'],
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
        },
    },
});
