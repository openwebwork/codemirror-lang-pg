#!/usr/bin/env node

/* eslint-disable @typescript-eslint/no-require-imports */
const { register } = require('module');
const { pathToFileURL } = require('url');
register('ts-node/esm/transpile-only', pathToFileURL('./'));

module.exports = {
    extension: ['ts'],
    spec: ['test/test.ts']
};
