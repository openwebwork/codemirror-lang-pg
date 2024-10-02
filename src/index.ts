import {
    LRLanguage,
    Language,
    LanguageSupport,
    continuedIndent,
    defineLanguageFacet,
    delimitedIndent,
    flatIndent,
    foldInside,
    foldNodeProp,
    indentNodeProp,
    languageDataProp
} from '@codemirror/language';
import { parseMixed } from '@lezer/common';
import type { CompletionContext } from '@codemirror/autocomplete';
import { snippetCompletion } from '@codemirror/autocomplete';
import { parser } from './pg.grammar';
import { PGMLParser } from './pgml';
import { pgmlLanguageData } from './pgml-language-data';
import { PGTextParser } from './pg-text';
import { pgTextLanguageData } from './pg-text-language-data';
export { pgmlShow } from './pgml-parse';

export const pgmlParser = new PGMLParser([
    indentNodeProp.add({ PGMLContent: () => null }),
    languageDataProp.add(pgmlLanguageData)
]);
export const pgmlLanguage = new Language(defineLanguageFacet(), pgmlParser, [], 'pgml');
export const pgml = () => new LanguageSupport(pgmlLanguage);

export const pgTextParser = new PGTextParser([
    indentNodeProp.add({ PGTextContent: () => null }),
    languageDataProp.add(pgTextLanguageData)
]);
export const pgTextLanguage = new Language(defineLanguageFacet(), pgTextParser, [], 'pg-text');
export const pgText = () => new LanguageSupport(pgTextLanguage);

export const pgLanguage = LRLanguage.define({
    name: 'pg',
    parser: parser.configure({
        props: [
            indentNodeProp.add({
                IfStatement: continuedIndent({ except: /^\s*({|else\b|elsif\b)/ }),
                Block: delimitedIndent({ closing: '}' }),
                String: () => null,
                Statement: continuedIndent(),
                'PGMLBlock PGTextBlock': flatIndent
            }),
            foldNodeProp.add({
                'Block Array ArrayRef HashRef PGMLBlock PGTextBlock': foldInside,
                'InterpolatedHeredocBody UninterpolatedHeredocBody': (node) => {
                    if (node.prevSibling && node.lastChild?.prevSibling)
                        return { from: node.prevSibling.to, to: node.lastChild.prevSibling.to };
                    return null;
                },
                'PGMLBlock PGTextBlock': (node) => {
                    if (node.firstChild?.type.name === 'BeginPG' && node.lastChild?.type.name === 'EndPG')
                        return { from: node.firstChild.to - 1, to: node.lastChild.from };
                    return null;
                },
                PodStatement(node) {
                    if (
                        node.firstChild?.type.name === 'PodDirective' &&
                        node.firstChild.nextSibling?.type.name === 'PodContent'
                    )
                        return { from: node.firstChild.nextSibling.from, to: node.firstChild.nextSibling.to };
                    return null;
                }
            })
        ],
        wrap: parseMixed((node) =>
            node.name === 'PGMLContent'
                ? { parser: pgmlParser }
                : node.name === 'PGTextContent'
                  ? { parser: pgTextParser }
                  : null
        )
    }),
    languageData: {
        commentTokens: { line: '#' },
        autocomplete: (context: CompletionContext) => {
            if (!context.matchBefore(/^\s*\w*/)) return;
            return {
                from: context.matchBefore(/\w+/)?.from ?? context.pos,
                options: ['PGML', 'PGML_HINT', 'PGML_SOLUTION', 'TEXT', 'HINT', 'SOLUTION'].map((t, i) =>
                    snippetCompletion(`BEGIN_${t}\n\${}\nEND_${t}`, {
                        label: `BEGIN_${t}`,
                        type: 'type',
                        boost: 99 - i
                    })
                )
            };
        }
    }
});

export const pg = () => new LanguageSupport(pgLanguage, [pgml().support, pgText().support]);
