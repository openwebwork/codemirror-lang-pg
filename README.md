# CodeMirror 6 perl language package

This is an example repository containing a minimal [CodeMirror](https://codemirror.net/6/) language support package. The
idea is to clone it, rename it, and edit it to create support for a new language.

Things you'll need to do (see the [language support example](https://codemirror.net/6/examples/lang-package/) for a more
detailed tutorial):

- Adjust the metadata in `src/index.ts` to work with your new grammar.

- Adjust the grammar tests in `test/cases.txt`.

- Build (`npm run prepare`) and test (`npm test`).

- Rewrite this readme file.

- Optionally add a license.

- Publish. Put your package on npm under a name like `codemirror-lang-perl`.
