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
    syntaxTree
} from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { parseMixed } from '@lezer/common';
import type { CompletionContext } from '@codemirror/autocomplete';
import { snippetCompletion } from '@codemirror/autocomplete';
import { parser } from './pg.grammar';
import { PGMLParser } from './pgml';
import { pgmlNodeProps } from './pgml-language-data';
import { PGTextParser } from './pg-text';
import { pgTextNodeProps } from './pg-text-language-data';

export { pgmlShow } from './pgml-parse';

export const pgmlParser = new PGMLParser(pgmlNodeProps);
export const pgmlLanguage = new Language(defineLanguageFacet(), pgmlParser, [], 'pgml');
export const pgml = () => new LanguageSupport(pgmlLanguage);

export const pgTextParser = new PGTextParser(pgTextNodeProps);
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
            for (
                let pos: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, -1);
                pos;
                pos = pos.parent
            ) {
                // When on the first line inside a PGMLBlock or PGTextBlock this autocomplete is called instead of the
                // PGML or PGText parser's autocomplete.  This seems to be a bug in codemirror.  At this point the
                // cursor is at the beginning of the PGMLContent or PGTextContent block, and so it should be the case
                // that the PGML or PGText parser's autocomplete method is called.  So at this point don't offer
                // autocompletion here since it wouldn't be appropriate.  Unfortunately, the PGML or PGText
                // autocompletion also doesn't get offered.
                if (
                    (pos.name === 'PGMLBlock' || pos.name === 'PGTextBlock') &&
                    pos.lastChild &&
                    pos.lastChild.name !== '⚠'
                )
                    return;

                if (pos.name === 'MethodInvocation') {
                    if (pos.parent?.name !== 'ExpressionStatement' && !context.explicit) break;
                    const arrowOperator = pos.getChild('ArrowOperator');
                    if (arrowOperator) {
                        const before = context.matchBefore(/\w*/);
                        if (arrowOperator.to === context.pos || before) {
                            return {
                                from: before?.from ?? context.pos,
                                options: ['LATEX_IMAGE', 'TIKZ'].map((t, i) =>
                                    snippetCompletion(`BEGIN_${t}\n\${}\nEND_${t}`, {
                                        label: `BEGIN_${t}`,
                                        type: 'interface',
                                        boost: 99 - i
                                    })
                                )
                            };
                        }
                    }
                    break;
                }
                if (pos.type.isTop) break;
            }

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
