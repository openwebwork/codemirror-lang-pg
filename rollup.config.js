import typescript from 'rollup-plugin-ts';
import { resolve, dirname } from 'path';
import { promises as fs } from 'fs';
import { buildParserFile } from '@lezer/generator';

const built = new Map();

export default {
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
                if (!source.endsWith('.grammar')) return null;
                return resolve(importer ? dirname(importer) : process.cwd(), source);
            },

            load(id) {
                if (!id.endsWith('.grammar')) return null;
                this.addWatchFile(id);
                const build =
                    built.get(id) ||
                    built
                        .set(
                            id,
                            fs.readFile(id, 'utf8').then((code) => {
                                const result = buildParserFile(code, {
                                    fileName: id,
                                    moduleStyle: 'es',
                                    warn: (message) => this.warn(message)
                                });
                                return fs.writeFile(`${id}.terms.js`, result.terms).then(() => result);
                            })
                        )
                        .get(id);
                return build.then((result) => result.parser);
            },

            watchChange(id) {
                built.delete(id);
            }
        },
        typescript()
    ]
};
