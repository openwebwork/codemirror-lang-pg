import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fileTests } from '@lezer/generator/dist/test';
import { pgLanguage } from '../dist/index.js';

const caseDir = dirname(fileURLToPath(import.meta.url));

for (const file of readdirSync(caseDir)) {
    if (!file.endsWith('.txt')) continue;

    const name = /^[^.]*/.exec(file)?.[0] ?? 'test';
    const tests = fileTests(readFileSync(join(caseDir, file), 'utf8'), file);

    describe(name, function () {
        for (const { name, run } of tests)
            it(name, function () {
                run(pgLanguage.parser);
            });
    });
}
