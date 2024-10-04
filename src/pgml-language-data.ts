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

const answerRuleSnippet = snippetCompletion('[_${}]${}{${$answer}}', {
    label: '[_]{ }',
    info: 'answer rule',
    section: { name: 'answer', rank },
    boost: i--
});

++rank;
const mathModeSnippets = [
    ['[` `]', 'inline math'],
    ['[`` ``]', 'display style math'],
    ['[``` ```]', 'block display math'],
    ['[: :]', 'parsed inline math'],
    ['[:: ::]', 'parsed display style math'],
    ['[::: :::]', 'parsed block display math']
].map(([label, info]) => {
    return snippetCompletion(label.replace(' ', '${ }') + '${}', {
        label,
        info,
        type: 'function',
        section: { name: 'math', rank },
        boost: i--
    });
});

const variableSnippet = snippetCompletion('[$${ }]${}', {
    label: '[$ ]',
    info: 'variable',
    section: { name: 'substitution', rank: ++rank },
    type: 'variable',
    boost: i--
});

const perlCommandSnippet = snippetCompletion('[@ ${ } @]${}', {
    label: '[@ @]',
    info: 'perl command',
    section: { name: 'substitution', rank },
    type: 'variable',
    boost: i--
});

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

const tableSnippet = snippetCompletion('[#${ }#]${}', {
    label: '[# #]',
    info: 'table',
    section: { name: 'table', rank: ++rank },
    type: 'type',
    boost: i--
});

const tableCellSnippet = snippetCompletion('[.${ }.]${}', {
    label: '[. .]',
    info: 'table cell',
    section: { name: 'table', rank },
    type: 'type',
    boost: i--
});

++rank;
const verbatimSnippets = [
    ['[| |]', 'verbatim'],
    ['[|| ||]', 'verbatim with unprocessed inner verbatim']
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
                (!inside('TableCell') || (textBefore.endsWith('[.') && !/^[ \t]*.\]/.test(textAfter)))
            ) {
                const previous = context.matchBefore(/\[|\[\./);
                return {
                    from: previous?.from ?? context.pos,
                    options: [tableCellSnippet]
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
                    options: [variableSnippet, perlCommandSnippet]
                };
            }

            const insideImage = inside('Image');
            if (insideImage == 2 || (insideImage == 1 && (!textBefore.endsWith('[!') || /^\s*!\]/.test(textAfter)))) {
                const previous = context.matchBefore(/\[[$@]?\s*$/);
                if (!previous && !context.explicit) return;
                return {
                    from: previous?.from ?? context.pos,
                    options: [variableSnippet, perlCommandSnippet]
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
                        answerRuleSnippet,
                        ...mathModeSnippets,
                        variableSnippet,
                        perlCommandSnippet,
                        imageSnippet,
                        tagSnippet,
                        commentSnippet,
                        tableSnippet,
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
                    answerRuleSnippet,
                    ...mathModeSnippets,
                    variableSnippet,
                    perlCommandSnippet,
                    imageSnippet,
                    tagSnippet,
                    commentSnippet,
                    tableSnippet,
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
