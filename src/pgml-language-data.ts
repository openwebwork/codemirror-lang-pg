import { defineLanguageFacet } from '@codemirror/language';
import { completeFromList, snippetCompletion } from '@codemirror/autocomplete';

const mathModeSnippets = [
    ['[` `]', 'inline math'],
    ['[`` ``]', 'display style math'],
    ['[``` ```]', 'block display math'],
    ['[: :]', 'parsed inline math'],
    ['[:: ::]', 'parsed display style math'],
    ['[::: :::]', 'parsed block display math']
].map(([label, info], i) => {
    return snippetCompletion(label.replace(' ', '${ }'), {
        label,
        info,
        type: 'function',
        section: { name: 'math', rank: 1 },
        boost: 99 - i
    });
});

const variableSnippet = snippetCompletion('[$${ }]', {
    label: '[$ ]',
    info: 'variable',
    section: { name: 'substitution', rank: 2 },
    type: 'variable',
    boost: 93
});

const perlCommandSnippet = snippetCompletion('[@ ${ } @]', {
    label: '[@ @]',
    info: 'perl command',
    section: { name: 'substitution', rank: 2 },
    type: 'variable',
    boost: 92
});

const imageSnippet = snippetCompletion('[!${alt}!]{${image}}', {
    label: '[! !]{ }',
    info: 'image',
    type: 'variable',
    section: { name: 'substitution', rank: 2 },
    boost: 91
});

const tagSnippet = snippetCompletion('[<${ }>]', {
    label: '[< >]',
    info: 'html tag',
    type: 'type',
    section: { name: 'formatting', rank: 3 },
    boost: 90
});

const tableSnippet = snippetCompletion('[#\n\t[.${ }.]\n#]', {
    label: '[#\n\t[. .]\n#]',
    info: 'table',
    section: { name: 'formatting', rank: 3 },
    type: 'type',
    boost: 89
});

const tableCellSnippet = snippetCompletion('[.${ }.]', {
    label: '[. .]',
    info: 'table cell',
    section: { name: 'formatting', rank: 3 },
    type: 'type',
    boost: 88
});

const preSnippet = snippetCompletion(':   ${ }', {
    label: ':   ',
    info: 'pre',
    section: { name: 'formatting', rank: 3 },
    type: 'type',
    boost: 87
});

export const pgmlLanguageData = {
    PGMLContent: defineLanguageFacet({
        commentTokens: { block: { open: '[%', close: '%]' } },
        autocomplete: completeFromList([
            ...mathModeSnippets,
            variableSnippet,
            perlCommandSnippet,
            imageSnippet,
            tagSnippet,
            tableSnippet,
            tableCellSnippet,
            preSnippet
        ]),
        // '[' is removed from this list because it interferes with the above snippets.
        closeBrackets: { brackets: ['(', '{', "'", '"'] }
    })
};
