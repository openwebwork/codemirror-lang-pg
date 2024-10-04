#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fileTests } from '@lezer/generator/dist/test';
import { pgLanguage } from './dist/index.js';

const argv = yargs(hideBin(process.argv))
    .usage('$0 <file>')
    .version(false)
    .option('file', {
        alias: 'f',
        description: 'Show the tree for code in a given PG file.',
        type: 'string'
    })
    .option('test-suite', {
        alias: 's',
        description: 'Show the tree for code in the specified test suite.',
        type: 'string'
    })
    .option('test', {
        alias: 't',
        description: 'Show the tree for only the specified test.',
        type: 'string'
    })
    .alias('help', 'h')
    .conflicts('file', 'test-suite')
    .check((argv) => (argv.f || argv.s ? true : 'Either the file or test-suite option is required.'))
    .parse();

const sources = [];

try {
    if (argv.f) {
        sources.push({ name: argv.f, text: readFileSync(argv.f, 'utf8') });
    } else if (argv.s) {
        const tests = fileTests(
            readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'test', `${argv.s}.txt`), 'utf8'),
            `${argv.s}.txt`
        );
        for (const { name, text } of tests) {
            if (argv.t && argv.t !== name) continue;
            sources.push({ name, text });
        }
    }
} catch (e) {
    console.log(e.message);
    process.exit();
}

const renderTree = (cursor, indent = '') => {
    const { name, from, to } = cursor;
    const haveChild = cursor.firstChild();
    if (haveChild) {
        console.log(`${indent}{`);
        console.log(`${indent}    "name": "${name}",`);
        console.log(`${indent}    "from": ${from},`);
        console.log(`${indent}    "to": ${to}${haveChild ? ',' : ''}`);
        console.log(`${indent}    "children": [`);
        for (;;) {
            renderTree(cursor, `${indent}        `);
            if (!cursor.nextSibling()) {
                cursor.parent();
                break;
            }
        }
        console.log(`${indent}    ]`);
    }
    const haveSibling = cursor.nextSibling();
    if (haveChild) {
        console.log(`${indent}}${haveSibling ? ',' : ''}`);
    } else {
        console.log(`${indent}{ "name": "${name}", "from": ${from}, "to": ${to} }${haveSibling ? ',' : ''}`);
    }
    if (haveSibling) renderTree(cursor, indent);
};

for (const { name, text } of sources) {
    console.log(`Test: \x1b[1m\x1b[34m${name}\x1b[0m\n`);
    console.log(text.trim());
    console.log('\n\x1b[1m\x1b[32m==>\x1b[0m\n');

    const tree = pgLanguage.parser.parse(text);

    renderTree(tree.cursor());

    console.log('');
}
