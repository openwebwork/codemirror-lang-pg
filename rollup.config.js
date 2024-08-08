import typescript from 'rollup-plugin-ts';
import { lezer } from '@lezer/generator/rollup';

export default {
    input: 'src/index.ts',
    output: [
        { file: 'dist/index.cjs', format: 'cjs' },
        { file: 'dist/index.js', format: 'es' }
    ],
    external: (id) => id != 'tslib' && !/^(\.?\/|\w:)/.test(id),
    plugins: [lezer(), typescript()]
};
