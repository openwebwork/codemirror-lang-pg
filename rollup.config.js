import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { resolve, dirname } from 'path';
import { promises as fs } from 'fs';
import { buildParserFile } from '@lezer/generator';

const built = new Map();

export default [
    {
        input: 'src/index.ts',
        output: [
            { file: 'dist/index.cjs', format: 'cjs' },
            { file: 'dist/index.js', format: 'es' }
        ],
        external: (id) => id != 'tslib' && !/^(\.?\/|\w:)/.test(id),
        plugins: [
            {
                name: 'rollup-plugin-grammar-parser',

                resolveId(source, importer) {
                    if (!source.endsWith('.grammar') && !source.endsWith('.grammar.terms.js')) return null;
                    return resolve(importer ? dirname(importer) : process.cwd(), source);
                },

                load(id) {
                    const isGrammarFile = id.endsWith('.grammar');
                    if (!isGrammarFile && !id.endsWith('.grammar.terms.js')) return null;
                    if (isGrammarFile) this.addWatchFile(id);
                    const grammarFile = id.replace(/\.terms\.js$/, '');
                    const build =
                        built.get(grammarFile) ||
                        built
                            .set(
                                grammarFile,
                                fs.readFile(grammarFile, 'utf8').then((code) => {
                                    return buildParserFile(code, {
                                        fileName: grammarFile,
                                        moduleStyle: 'es',
                                        warn: (message) => this.warn(message)
                                    });
                                })
                            )
                            .get(grammarFile);
                    return build.then((result) => (isGrammarFile ? result.parser : result.terms));
                },

                watchChange(id) {
                    built.delete(id);
                }
            },
            typescript({ declaration: false })
        ]
    },
    {
        input: 'src/index.ts',
        output: [
            { file: 'dist/index.d.cts', format: 'cjs' },
            { file: 'dist/index.d.ts', format: 'es' }
        ],
        plugins: [dts()]
    }
];
