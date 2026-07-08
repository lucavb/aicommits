import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import type { RollupOptions } from 'rollup';
import { readFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default {
    input: 'src/cli.ts',
    output: {
        banner: '#!/usr/bin/env node',
        file: 'dist/cli.mjs',
        format: 'esm',
        sourcemap: true,
    },
    plugins: [
        resolve(),
        commonjs(),
        typescript(),
        json(),
        // Inversify resolves class-based bindings by identity, but its metadata/error
        // reporting also relies on constructor.name; minifiers renaming classes breaks
        // DI resolution at runtime, so class/function names must be preserved.
        terser({ keep_classnames: true, keep_fnames: true }),
    ],
    external: Object.keys(packageJson.dependencies),
} satisfies RollupOptions;
