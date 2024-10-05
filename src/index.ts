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
import { completeFromList, snippetCompletion } from '@codemirror/autocomplete';
import { parser } from './pg.grammar';
import { PGMLParser } from './pgml';
import { pgmlNodeProps } from './pgml-language-data';
import { PGTextParser } from './pg-text';
import { pgTextNodeProps } from './pg-text-language-data';
import { pgVariables } from './pg-variables';

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
                'StringSingleQuoted StringQQuoted StringDoubleQuoted StringQqQuoted': () => null,
                'InterpolatedHeredocBody UninterpolatedHeredocBody': () => null,
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
            const nodeAt = syntaxTree(context.state).resolveInner(context.pos, -1);

            // If in one of the named nodes, then this returns and array whose first element is 2 if inside a complete
            // node and 1 if inside an incomplete node, and whose second element is the node.  It returns undefined if
            // in none of the named nodes..
            const inside = (nodeNames: string | string[]): [number, SyntaxNode] | undefined => {
                for (let pos: SyntaxNode | null = nodeAt; pos; pos = pos.parent) {
                    if ((nodeNames instanceof Array && nodeNames.includes(pos.name)) || nodeNames === pos.name)
                        return [pos.lastChild && pos.lastChild.name !== '⚠' ? 2 : 1, pos];
                    if (pos.type.isTop) break;
                }
            };

            // When on the first line inside a PGMLBlock or PGTextBlock this autocomplete is called instead of the PGML
            // or PGText parser's autocomplete.  This seems to be a bug in codemirror.  At this point the cursor is at
            // the beginning of the PGMLContent or PGTextContent block, and so it should be the case that the PGML or
            // PGText parser's autocomplete method is called.  So at this point don't offer autocompletion here since it
            // wouldn't be appropriate.  Unfortunately, the PGML or PGText autocompletion also doesn't get offered.
            if (inside(['PGMLBlock', 'PGTextBlock'])?.[0] === 2) return;

            const [insideMethodInvocation, methodInvocation] = inside('MethodInvocation') ?? [];
            if (
                insideMethodInvocation &&
                methodInvocation &&
                (methodInvocation.parent?.name === 'ExpressionStatement' || context.explicit)
            ) {
                const arrowOperator = methodInvocation.getChild('ArrowOperator');
                if (arrowOperator && context.matchBefore(/->\w*$/)) {
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
            }

            if (context.matchBefore(/\$\w*$/)) {
                return completeFromList(Array.from(pgVariables.values()).map((label) => ({ label, type: 'variable' })))(
                    context
                );
            }

            if (!inside(['InterpolatedHeredocBody', 'UninterpolatedHeredocBody']) && context.matchBefore(/^\s*\w*/)) {
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
    }
});

export const pg = () => new LanguageSupport(pgLanguage, [pgml().support, pgText().support]);
