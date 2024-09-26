#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PGMLShow } from './dist/index.js';

const argv = yargs(hideBin(process.argv))
    .usage('$0 <file>')
    .version(false)
    .option('file', {
        alias: 'f',
        description: 'Show the PGML parse result for text in the specified file.',
        type: 'string'
    })
    .option('test-suite', {
        alias: 's',
        description: 'Show the PGML parse result for text in the specified test suite.',
        type: 'string'
    })
    .option('test', {
        alias: 't',
        description: 'Show the PGML parse result for only the specified test (must also specify a test suite).',
        type: 'string'
    })
    .alias('help', 'h')
    .conflicts('file', 'test-suite')
    .check((argv) => (argv.f || argv.s ? true : 'Either the file or test-suite option is required.'))
    .parse();

const sources = [];

const caseDir = join(dirname(fileURLToPath(import.meta.url)), 'test');

const toLineContext = (file, index) => {
    const endEol = file.indexOf('\n', index + 80);
    const endIndex = endEol === -1 ? file.length : endEol;
    return file
        .substring(index, endIndex)
        .split(/\n/)
        .map((str) => '  | ' + str)
        .join('\n');
};

const fileTests = (file) => {
    const source = readFileSync(join(caseDir, file), 'utf8');
    const caseExpr = RegExp(
        /\s*#[ \t]*(.*)(?:\r\n|\r|\n)([^]*?)/.source +
            /==+>(?:[^]*?)(?:(?:\r\n|\r|\n)+)==+>([^]*?)(?:$|(?:\r\n|\r|\n)+(?=#))/.source,
        'gy'
    );
    const tests = [];
    let lastIndex = 0;
    for (;;) {
        const m = caseExpr.exec(source);
        if (!m) throw new Error(`Unexpected file format in ${file} around\n\n${toLineContext(source, lastIndex)}`);
        const [, name] = /(.*?)(?: \\\{\s*(.*?)\s*\\\})?$/.exec(m[1]);
        tests.push({
            name: name.trim(),
            text: m[2].trim()
        });
        lastIndex = m.index + m[0].length;
        if (lastIndex == source.length) break;
    }
    return tests;
};

try {
    if (argv.f) {
        sources.push({ name: argv.f, text: readFileSync(argv.f, 'utf8').trim() });
    } else if (argv.s) {
        const tests = fileTests(`${argv.s}.txt`);
        for (const { name, text } of tests) {
            if (argv.t && argv.t !== name) continue;
            sources.push({ name, text });
        }
    }
} catch (e) {
    console.log(e.message);
    process.exit();
}

for (const { name, text } of sources) {
    const source = /BEGIN_PGML/.test(text)
        ? text.replace(/^[\s\S]*?BEGIN_PGML\n([\s\S]*?)END_PGML[\s\S]*$/y, '$1')
        : text;
    console.log(`Test: \x1b[1m\x1b[34m${name}\x1b[0m\n`);
    console.log(source);
    console.log('\n\x1b[1m\x1b[32m==>\x1b[0m\n');
    console.log(PGMLShow(source));
    console.log();
}
