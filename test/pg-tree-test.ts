import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pgLanguage } from '../dist/index.js';
import { toLineContext } from './test-util.js';
import { checkTree } from './compare-tree.js';

const caseDir = dirname(fileURLToPath(import.meta.url));

for (const file of readdirSync(caseDir)) {
    if (!file.startsWith('pg') || !file.endsWith('.txt')) continue;

    const fileContent = readFileSync(join(caseDir, file), 'utf8');

    // The pgml files have two test cases.  This file uses the first one only.  The pg text tests only have one case.
    const caseExpr = file.startsWith('pgml')
        ? RegExp(
              /\s*#[ \t]*(.*)(?:\r\n|\r|\n)([^]*?)==+>([^]*?)(?:(?:\r\n|\r|\n)+)/.source +
                  /(?:==+>(?:[^]*?)(?:$|(?:\r\n|\r|\n)+(?=#)))/.source,
              'gy'
          )
        : /\s*#[ \t]*(.*)(?:\r\n|\r|\n)([^]*?)==+>([^]*?)(?:$|(?:\r\n|\r|\n)+(?=#))/gy;

    const tests: { name: string; run: () => void }[] = [];
    let lastIndex = 0;
    for (;;) {
        const m = caseExpr.exec(fileContent);
        if (!m) throw new Error(`Unexpected file format in ${file} around\n\n${toLineContext(fileContent, lastIndex)}`);
        const [, name] = /(.*?)(?: \\\{\s*(.*?)\s*\\\})?$/.exec(m[1]) ?? ['', ''];
        tests.push({
            name: name.trim(),
            run() {
                const tree = pgLanguage.parser.parse(m[2].trim());
                checkTree(tree, m[3].trim());
            }
        });
        lastIndex = m.index + m[0].length;
        if (lastIndex == fileContent.length) break;
    }

    const name = file.replace(/\.txt$/, '').replaceAll('-', ' ');

    describe(name, function () {
        for (const test of tests)
            it(test.name, function () {
                test.run();
            });
    });
}
