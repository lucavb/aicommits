import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import type { RollupOptions } from 'rollup';

export default {
    input: 'src/cli.ts',
    output: {
        file: 'dist/cli.mjs',
        format: 'esm',
        sourcemap: true,
    },
    plugins: [resolve(), commonjs(), typescript(), json(), terser()],
    external: [
        // List external dependencies here
    ],
} satisfies RollupOptions;
