import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fileTests } from '@lezer/generator/dist/test';
import { pgLanguage } from '../dist/index.js';

const caseDir = dirname(fileURLToPath(import.meta.url));

for (const file of readdirSync(caseDir)) {
    if (file.startsWith('pg') || !file.endsWith('.txt')) continue;

    const name = file.replace(/\.txt$/, '').replaceAll('-', ' ');
    const tests = fileTests(readFileSync(join(caseDir, file), 'utf8'), file);

    describe(name, function () {
        for (const test of tests)
            it(test.name, function () {
                test.run(pgLanguage.parser);
            });
    });
}
