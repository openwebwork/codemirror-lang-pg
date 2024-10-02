import type { SyntaxNode } from '@lezer/common';
import { defineLanguageFacet, syntaxTree } from '@codemirror/language';
import type { CompletionContext } from '@codemirror/autocomplete';
import { snippetCompletion } from '@codemirror/autocomplete';

let i = 99;
let rank = 1;

const answerRuleSnippet = snippetCompletion('[_${}]${}{${answer}}', {
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
    return snippetCompletion(label.replace(' ', '${ }'), {
        label,
        info,
        type: 'function',
        section: { name: 'math', rank },
        boost: i--
    });
});

const variableSnippet = snippetCompletion('[$${ }]', {
    label: '[$ ]',
    info: 'variable',
    section: { name: 'substitution', rank: ++rank },
    type: 'variable',
    boost: i--
});

const perlCommandSnippet = snippetCompletion('[@ ${ } @]', {
    label: '[@ @]',
    info: 'perl command',
    section: { name: 'substitution', rank },
    type: 'variable',
    boost: i--
});

const imageSnippet = snippetCompletion('[!${alt}!]{${image}}', {
    label: '[! !]{ }',
    info: 'image',
    type: 'variable',
    section: { name: 'substitution', rank },
    boost: i--
});

const tagSnippet = snippetCompletion('[< ${ } >]', {
    label: '[< >]',
    info: 'html tag',
    type: 'type',
    section: { name: 'formatting', rank: ++rank },
    boost: i--
});

const tableSnippet = snippetCompletion('[# [.${ }.] #]', {
    label: '[# [. .] #]',
    info: 'table',
    section: { name: 'formatting', rank },
    type: 'type',
    boost: i--
});

const tableCellSnippet = snippetCompletion('[.${ }.]', {
    label: '[. .]',
    info: 'table cell',
    section: { name: 'formatting', rank },
    type: 'type',
    boost: i--
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
            const isIn = (nodeName: string) => {
                for (
                    let pos: SyntaxNode | null = syntaxTree(context.state).resolveInner(context.pos, 0);
                    pos;
                    pos = pos.parent
                ) {
                    if (pos.name === nodeName && (!pos.lastChild || pos.lastChild.name !== 'PGMLError')) return true;
                    if (pos.type.isTop) break;
                }
                return false;
            };

            const previous = context.matchBefore(/.*/);

            if (isIn('Table') && !isIn('TableCell')) {
                return {
                    from:
                        previous && previous.text.lastIndexOf('[') !== -1
                            ? previous.from + previous.text.lastIndexOf('[')
                            : context.pos,
                    options: [tableCellSnippet]
                };
            }

            if (isIn('MathMode')) {
                return {
                    from:
                        previous && previous.text.lastIndexOf('[') !== -1
                            ? previous.from + previous.text.lastIndexOf('[')
                            : context.pos,
                    options: [variableSnippet, perlCommandSnippet]
                };
            }

            if (previous && /\[(`*|:*|[$@!<#])$/.test(previous.text)) {
                return {
                    from: previous.from + previous.text.lastIndexOf('['),
                    options: [
                        answerRuleSnippet,
                        ...mathModeSnippets,
                        variableSnippet,
                        perlCommandSnippet,
                        imageSnippet,
                        tagSnippet,
                        tableSnippet
                    ]
                };
            }

            if (previous && /^(\s{4})*:\s*/.test(previous.text)) {
                return {
                    from: previous.from + previous.text.lastIndexOf(':'),
                    options: [preSnippet]
                };
            }

            if (!context.explicit) return null;

            return {
                from: context.pos,
                options: [
                    answerRuleSnippet,
                    ...mathModeSnippets,
                    variableSnippet,
                    perlCommandSnippet,
                    imageSnippet,
                    tagSnippet,
                    tableSnippet,
                    preSnippet
                ]
            };
        },
        // '[' is removed from this list because it interferes with the above snippets.
        closeBrackets: { brackets: ['(', '{', "'", '"'] }
    })
};
