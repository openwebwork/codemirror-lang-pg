import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fileTests } from '@lezer/generator/dist/test';
import { pgLanguage } from '../dist/index.js';
import { toLineContext } from './test-util.js';

const caseDir = dirname(fileURLToPath(import.meta.url));

for (const file of readdirSync(caseDir)) {
    if (!file.endsWith('.txt')) continue;

    const fileContent = readFileSync(join(caseDir, file), 'utf8');

    let testString = '';
    if (file.startsWith('pgml-')) {
        // Remove the pgml parse test result and reformat for the @lezer/generator fileTests method.
        const caseExpr = RegExp(
            /\s*(#[ \t]*(?:.*)(?:\r\n|\r|\n)(?:[^]*?)==+>(?:[^]*?)(?:(?:\r\n|\r|\n)+))/.source +
                /(==+>(?:[^]*?)(?:$|(?:\r\n|\r|\n)+(?=#)))/.source,
            'gy'
        );
        let lastIndex = 0;
        for (;;) {
            const m = caseExpr.exec(fileContent);
            if (!m)
                throw new Error(`Unexpected file format in ${file} around\n\n${toLineContext(fileContent, lastIndex)}`);
            testString += m[1];
            lastIndex = m.index + m[0].length;
            if (lastIndex == fileContent.length) break;
        }
    } else testString = fileContent;

    const name = file.replace(/\.txt$/, '').replaceAll('-', ' ');
    const tests = fileTests(testString, file);

    describe(name, function () {
        for (const { name, run } of tests)
            it(name, function () {
                run(pgLanguage.parser);
            });
    });
}
