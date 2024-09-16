#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chokidar from 'chokidar';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { buildParserFile } from '@lezer/generator';

const argv = yargs(hideBin(process.argv))
    .usage('$0 Options')
    .version(false)
    .alias('help', 'h')
    .wrap(100)
    .option('watch-files', {
        alias: 'w',
        description: 'Continue to watch files for changes. (Developer tool)',
        type: 'boolean'
    })
    .option('clean', {
        alias: 'd',
        description: 'Delete all generated files.',
        type: 'boolean'
    })
    .parse();

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src');

const cleanDir = (dir) => {
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
        if (file.name === 'pg.parser.js' || file.name === 'pg.grammar.terms.js') {
            const fullPath = path.resolve(dir, file.name);
            console.log(`\x1b[34mRemoving ${fullPath}.\x1b[0m`);
            fs.unlinkSync(fullPath);
        }
    }
};

// The is set to true after all files are processed for the first time.
let ready = false;

const processFile = async (file) => {
    if (file) {
        console.log(`\x1b[32mProcessing ${file}\x1b[0m`);
        const endMessage = ready ? `\x1b[32mUpdated ${file}\x1b[0m` : `\x1b[32mGenerated ${file}\x1b[0m`;
        console.time(endMessage);
        const source = fs.readFileSync(path.resolve(srcDir, file), 'utf8');
        try {
            // Only the terms are needed for the build. The parser is not.
            const { /* parser, */ terms } = buildParserFile(source, { fileName: file });
            //fs.writeFileSync(path.resolve(srcDir, 'pg.parser.js'), parser);
            fs.writeFileSync(path.resolve(srcDir, 'pg.grammar.terms.js'), terms);
        } catch (e) {
            console.log(`ERROR: ${e.message}`);
        }
        console.timeEnd(endMessage);
    } else {
        if (argv.watchFiles) {
            console.log(
                '\x1b[33mWatches established, and initial generation complete.\n' + 'Press Control-C to stop.\x1b[0m'
            );
        }
        ready = true;
    }
};

// Remove generated files from previous builds.
cleanDir(srcDir);

if (argv.clean) process.exit();

// Set up the watcher.
if (argv.watchFiles) console.log('\x1b[32mEstablishing watches and performing initial generation.\x1b[0m');
chokidar
    .watch([path.resolve(srcDir, 'pg.grammar')], {
        cwd: srcDir, // Make paths be given relative to the src directory.
        awaitWriteFinish: { stabilityThreshold: 500 },
        persistent: argv.watchFiles ? true : false
    })
    .on('add', processFile)
    .on('change', processFile)
    .on('ready', processFile)
    .on('error', (error) => console.log(`\x1b[32m${error}\x1b[0m`));
