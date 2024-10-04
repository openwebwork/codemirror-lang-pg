import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as assert from 'assert';
import { pgmlShow } from '../dist/index.js';
import { toLineContext } from './test-util.js';

const caseDir = dirname(fileURLToPath(import.meta.url));

const fileTests = (file: string) => {
    const source = readFileSync(join(caseDir, file), 'utf8');
    const caseExpr = RegExp(
        /\s*#[ \t]*(.*)(?:\r\n|\r|\n)([^]*?)/.source +
            /==+>(?:[^]*?)(?:(?:\r\n|\r|\n)+)==+>([^]*?)(?:$|(?:\r\n|\r|\n)+(?=#))/.source,
        'gy'
    );
    const tests: { name: string; run: (parser: (input: string) => string) => void }[] = [];
    let lastIndex = 0;
    for (;;) {
        const m = caseExpr.exec(source);
        if (!m) throw new Error(`Unexpected file format in ${file} around\n\n${toLineContext(source, lastIndex)}`);
        const [, name] = /(.*?)(?: \\\{\s*(.*?)\s*\\\})?$/.exec(m[1]) ?? ['', ''];
        tests.push({
            name: name.trim(),
            run(parser: (input: string) => string) {
                assert.equal(
                    parser(m[2].trim().replace(/^[\s\S]*?BEGIN_PGML\n([\s\S]*?)END_PGML[\s\S]*$/y, '$1')),
                    m[3].trim()
                );
            }
        });
        lastIndex = m.index + m[0].length;
        if (lastIndex == source.length) break;
    }
    return tests;
};

for (const file of readdirSync(caseDir)) {
    if (!file.startsWith('pgml-') || !file.endsWith('.txt')) continue;

    const testName = file
        .replace(/^pgml-/, 'pgml parse ')
        .replace(/\.txt$/, '')
        .replaceAll('-', ' ');
    const tests = fileTests(file);

    describe(testName, function () {
        for (const test of tests)
            it(test.name, function () {
                test.run(pgmlShow);
            });
    });
}
