#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { format } from 'prettier';
import { fileTests } from '@lezer/generator/dist/test';
import { pgmlLanguage } from './dist/index.js';

const argv = yargs(hideBin(process.argv))
    .usage('$0 <file>')
    .version(false)
    .option('file', {
        alias: 'f',
        description: 'Show the tree for code in a given Perl file.',
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

const keywords = [
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'function',
    'if',
    'implements',
    'import',
    'in',
    'instanceof',
    'interface',
    'let',
    'new',
    'null',
    'package',
    'private',
    'protected',
    'public',
    'require',
    'return',
    'static',
    'super',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield'
];

for (const { name, text } of sources) {
    console.log(`Test: \x1b[1m\x1b[34m${name}\x1b[0m\n`);
    console.log(text.trim());
    console.log('\n\x1b[1m\x1b[32m==>\x1b[0m\n');

    const tree = pgmlLanguage.parser.parse(text);

    try {
        let adjustedSource = tree.toString().replaceAll('⚠', '"⚠"');
        for (const keyword of keywords) {
            const keywordRegexp = new RegExp(`\\b(${keyword})\\b`, 'g');
            adjustedSource = adjustedSource.replace(keywordRegexp, '_$1_');
        }

        let formattedProgram = await format(adjustedSource, {
            parser: 'babel',
            semi: false,
            printWidth: 120,
            tabWidth: 4,
            trailingComma: 'none'
        });

        formattedProgram = formattedProgram.replaceAll('"⚠"', '\x1b[41m\x1b[37m⚠\x1b[0m');

        for (const keyword of keywords) {
            const keywordRegexp = new RegExp(`\\b_(${keyword})_\\b`, 'g');
            formattedProgram = formattedProgram.replace(keywordRegexp, '$1');
        }

        console.log(formattedProgram);
    } catch (e) {
        console.log(e.message);
        console.log(tree.toString());
    }
}
