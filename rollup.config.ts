import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

export default {
    input: 'src/index.ts',
    output: {
        file: 'dist/bundle.js',
        format: 'cjs',
        sourcemap: true,
    },
    plugins: [
        resolve(),
        commonjs(),
        typescript(), // This will use the tsconfig.json file by default
        terser(),
    ],
    external: [
        // List external dependencies here
    ],
};
