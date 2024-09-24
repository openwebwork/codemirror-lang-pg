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
    indentNodeProp
} from '@codemirror/language';
import { parseMixed } from '@lezer/common';
import { completeFromList } from '@codemirror/autocomplete';
import { parser } from './pg.grammar';
import { parser as PGMLParser } from './pgml';
import { parser as PGTextParser } from './pg-text';
export { PGMLShow } from './pgml-parse';

export const pgmlLanguage = new Language(defineLanguageFacet(), PGMLParser, [], 'pgml');

export const pgmlCompletion = pgmlLanguage.data.of({
    autocomplete: completeFromList([{ label: 'my', type: 'keyword' }])
});

export const pgml = () => new LanguageSupport(pgmlLanguage, [pgmlCompletion]);

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
                ? { parser: PGMLParser }
                : node.name === 'PGTextContent'
                  ? { parser: PGTextParser }
                  : null
        )
    }),
    languageData: { commentTokens: { line: '#' } }
});

export const pgCompletion = pgLanguage.data.of({
    autocomplete: completeFromList([
        { label: 'my', type: 'keyword' },
        { label: 'use', type: 'keyword' },
        { label: 'sub', type: 'keyword' }
    ])
});

export const pg = () => new LanguageSupport(pgLanguage, [pgCompletion]);
