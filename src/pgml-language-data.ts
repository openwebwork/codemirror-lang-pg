import type { SyntaxNode } from '@lezer/common';
import {
    defineLanguageFacet,
    delimitedIndent,
    indentNodeProp,
    languageDataProp,
    syntaxTree
} from '@codemirror/language';
import type { CompletionContext } from '@codemirror/autocomplete';
import { snippetCompletion } from '@codemirror/autocomplete';

export const pgmlIndent = {
    PerlCommand: delimitedIndent({ closing: '@]' }),
    Table: delimitedIndent({ closing: '#]' }),
    Tag: delimitedIndent({ closing: '>]' })
};

let i = 99;
let rank = 1;

const answerRuleSnippets = [
    snippetCompletion('[_${}]${}{${$answer}}${}', {
        label: '[_]{ }',
        info: 'answer rule',
        section: { name: 'answer', rank },
        boost: i--
    }),
    snippetCompletion('[_${}]*{${$answer}}${}', {
        label: '[_]*{ }',
        info: 'array answer rule',
        section: { name: 'answer', rank },
        boost: i--
    })
];

++rank;
const mathModeSnippets = [
    ['[` `]', 'inline math'],
    ['[`` ``]', 'display style math'],
    ['[``` ```]', 'block display math'],
    ['[: :]', 'parsed inline math'],
    ['[:: ::]', 'parsed display style math'],
    ['[::: :::]', 'parsed block display math'],
    ['[: :]*', 'parsed inline math in active context'],
    ['[:: ::]*', 'parsed display style math in active context'],
    ['[::: :::]*', 'parsed block display math in active context'],
    ['[: :]**', 'parsed and reduced inline math in active context'],
    ['[:: ::]**', 'parsed and reduced display style math in active context'],
    ['[::: :::]**', 'parsed and reduced block display math in active context']
].map(([label, info]) => {
    return snippetCompletion(label.replace(' ', '${ }') + '${}', {
        label,
        info,
        type: 'function',
        section: { name: 'math', rank },
        boost: i--
    });
});

const variableSnippets = [
    snippetCompletion('[$${ }]${}', {
        label: '[$ ]',
        info: 'variable',
        section: { name: 'substitution', rank: ++rank },
        type: 'variable',
        boost: i--
    }),
    snippetCompletion('[$${ }]*${}', {
        label: '[$ ]*',
        info: 'variable with value not HTML escaped',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    }),
    snippetCompletion('[$${ }]**${}', {
        label: '[$ ]**',
        info: 'variable with value PGML parsed',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    }),
    snippetCompletion('[$${ }]***${}', {
        label: '[$ ]***',
        info: 'variable with LaTeX value not HTML escaped',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    })
];

const perlCommandSnippets = [
    snippetCompletion('[@ ${ } @]${}', {
        label: '[@ @]',
        info: 'perl command',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    }),
    snippetCompletion('[@ ${ } @]*${}', {
        label: '[@ @]*',
        info: 'perl command with result not HTML escaped',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    }),
    snippetCompletion('[@ ${ } @]**${}', {
        label: '[@ @]**',
        info: 'perl command with result PGML parsed',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    }),
    snippetCompletion('[@ ${ } @]***${}', {
        label: '[@ @]***',
        info: 'perl command with LaTeX result not HTML escaped',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    }),
    snippetCompletion('[@\n\t${ }\n@]${}', {
        label: '[@ @]',
        info: 'perl command (multi line)',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    }),
    snippetCompletion('[@\n\t${ }\n@]*${}', {
        label: '[@ @]*',
        info: 'perl command with result not HTML escaped (multi line)',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    }),
    snippetCompletion('[@\n\t${ }\n@]**${}', {
        label: '[@ @]**',
        info: 'perl command with result PGML parsed (multi line)',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    }),
    snippetCompletion('[@\n\t${ }\n@]***${}', {
        label: '[@ @]***',
        info: 'perl command with LaTeX result not HTML escaped (multi line)',
        section: { name: 'substitution', rank },
        type: 'variable',
        boost: i--
    })
];

const imageSnippet = snippetCompletion('[!${alt text}!]{${$source}}${}', {
    label: '[! !]{ }',
    info: 'image',
    type: 'type',
    section: { name: 'substitution', rank },
    boost: i--
});

const tagSnippet = snippetCompletion('[<${ }>]${}', {
    label: '[< >]',
    info: 'html tag',
    type: 'type',
    section: { name: 'substitution', rank: ++rank },
    boost: i--
});

const commentSnippet = snippetCompletion('[% ${ } %]${}', {
    label: '[% %]',
    info: 'comment',
    type: 'type',
    section: { name: 'substitution', rank },
    boost: i--
});

const tableSnippets = [
    snippetCompletion('[#\n\t[.${ }.]${}\n#]${}', {
        label: '[# [. .] #]',
        info: 'table (multi line)',
        section: { name: 'table', rank: ++rank },
        type: 'type',
        boost: i--
    }),
    snippetCompletion('[#\n\t[.${ }.]${}\n#]*${}', {
        label: '[# [. .] #]*',
        info: 'layout table (multi line)',
        section: { name: 'table', rank },
        type: 'type',
        boost: i--
    }),
    snippetCompletion('[# [.${ }.]${} #]${}', {
        label: '[# [. .] #]',
        info: 'table (single line)',
        section: { name: 'table', rank },
        type: 'type',
        boost: i--
    }),
    snippetCompletion('[# [.${ }.]${} #]*${}', {
        label: '[# [. .] #]*',
        info: 'layout table (single line)',
        section: { name: 'table', rank },
        type: 'type',
        boost: i--
    })
];

const tableCellSnippets = [
    snippetCompletion('[.${ }.]${}', {
        label: '[. .]',
        info: 'table cell',
        section: { name: 'table', rank },
        type: 'type',
        boost: i--
    }),
    snippetCompletion('[.${ }.]*${}', {
        label: '[. .]',
        info: 'table cell at end of table row',
        section: { name: 'table', rank },
        type: 'type',
        boost: i--
    })
];

++rank;
const verbatimSnippets = [
    ['[| |]', 'verbatim'],
    ['[| |]*', 'verbatim code'],
    ['[|| ||]', 'verbatim with unprocessed inner verbatim'],
    ['[|| ||]*', 'verbatim code with unprocessed inner verbatim']
].map(([label, info]) => {
    return snippetCompletion(label.replace(' ', '${ }') + '${}', {
        label,
        info,
        type: 'type',
        section: { name: 'formatting', rank },
        boost: i--
    });
});

const preSnippet = snippetCompletion(':   ${}', {
    label: ':   ',
    info: 'pre',
    section: { name: 'formatting', rank },
    type: 'type',
    boost: i--
});

export const pgmlLanguageData = {
    PGMLContent: defineLanguageFacet({
        commentTokens: { block: { open: '[%', close: '%]' } },
        autocomplete: (context: CompletionContext) => {
            const nodeAt = syntaxTree(context.state).resolveInner(context.pos, 0);
            const currentLine = context.state.doc.lineAt(context.pos);
            const textBefore = currentLine.text.slice(0, context.pos - currentLine.from);
            const textAfter = currentLine.text.slice(context.pos - currentLine.from);

            // This returns 2 if inside a complete node, 1 if inside an incomplete node, and false otherwise.
            const inside = (nodeNames: string | string[]) => {
                for (let pos: SyntaxNode | null = nodeAt; pos; pos = pos.parent) {
                    if ((nodeNames instanceof Array && nodeNames.includes(pos.name)) || nodeNames === pos.name)
                        return (pos.name === 'Comment' && !pos.lastChild) ||
                            (pos.name !== 'Comment' && pos.lastChild && pos.lastChild.name !== 'PGMLError')
                            ? 2
                            : 1;
                    if (pos.type.isTop) break;
                }
                return false;
            };

            if (inside(['Comment', 'PerlCommand', 'Variable', 'Option', 'Verbatim']) === 2) return;

            const insideTable = inside('Table');
            if (
                (insideTable == 2 || (insideTable == 1 && (!textBefore.endsWith('[#') || /^\s*#\]/.test(textAfter)))) &&
                ((!inside('TableCell') && !textBefore.endsWith('.]*')) ||
                    (textBefore.endsWith('[.') && !/^[ \t]*\.\]/.test(textAfter)))
            ) {
                const previous = context.matchBefore(/\[|\[\./);
                return {
                    from: previous?.from ?? context.pos,
                    options: tableCellSnippets
                };
            }

            const insideMathMode = inside('MathMode');
            if (
                insideMathMode == 2 ||
                (insideMathMode == 1 &&
                    (!/\[`{1,3}$/.test(textBefore) || /^\s*`{1,3}\]/.test(textAfter)) &&
                    (!/\[:{1,3}$/.test(textBefore) || /^\s*:{1,3}\]/.test(textAfter)))
            ) {
                const previous = context.matchBefore(/\[|\[\$|\[@/);
                if (!previous && !context.explicit) return;
                return {
                    from: previous?.from ?? context.pos,
                    options: [...variableSnippets, ...perlCommandSnippets]
                };
            }

            const insideImage = inside('Image');
            if (insideImage == 2 || (insideImage == 1 && (!textBefore.endsWith('[!') || /^\s*!\]/.test(textAfter)))) {
                const previous = context.matchBefore(/\[[$@]?\s*$/);
                if (!previous && !context.explicit) return;
                return {
                    from: previous?.from ?? context.pos,
                    options: [...variableSnippets, ...perlCommandSnippets]
                };
            }

            const insideVerbatim = inside('Verbatim');
            if (
                insideVerbatim == 2 ||
                (insideVerbatim == 1 && (!/\[\|*$/.test(textBefore) || /^\s*\|*\]/.test(textAfter)))
            ) {
                return null;
            }

            if (/\[(`{1,3}|:{1,3}|\|{1,}|[_$@!<#%])?[\t ]*$/.test(textBefore)) {
                const previous = context.matchBefore(/\[(`{1,3}|:{1,3}|\|{1,}|[_$@!<#%])?[\t ]*$/);
                if (!previous && !context.explicit) return;
                return {
                    from: previous?.from ?? context.pos,
                    options: [
                        ...answerRuleSnippets,
                        ...mathModeSnippets,
                        ...variableSnippets,
                        ...perlCommandSnippets,
                        imageSnippet,
                        tagSnippet,
                        commentSnippet,
                        ...tableSnippets,
                        ...verbatimSnippets
                    ]
                };
            }

            if (/^(\s{4})*:\s*/.test(textBefore)) {
                const previous = context.matchBefore(/:\s*/);
                return {
                    from: previous?.from ?? context.pos,
                    options: [preSnippet]
                };
            }

            if (!context.explicit) return;

            return {
                from: context.pos,
                options: [
                    ...answerRuleSnippets,
                    ...mathModeSnippets,
                    ...variableSnippets,
                    ...perlCommandSnippets,
                    imageSnippet,
                    tagSnippet,
                    commentSnippet,
                    ...tableSnippets,
                    ...verbatimSnippets,
                    preSnippet
                ]
            };
        },
        // '[' is removed from this list because it interferes with the above snippets.
        closeBrackets: { brackets: ['(', '{', "'", '"'] }
    })
};

export const pgmlNodeProps = [indentNodeProp.add(pgmlIndent), languageDataProp.add(pgmlLanguageData)];
