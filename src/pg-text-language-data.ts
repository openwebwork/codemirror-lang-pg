import { defineLanguageFacet } from '@codemirror/language';
import { completeFromList, snippetCompletion } from '@codemirror/autocomplete';

export const pgTextLanguageData = {
    PGTextContent: defineLanguageFacet({
        autocomplete: completeFromList([
            snippetCompletion('\\\\{${ }\\\\}', {
                label: '\\{ \\}',
                info: 'perl command',
                type: 'constant',
                boost: 99
            }),
            snippetCompletion('\\(${ }\\)', {
                label: '\\( \\)',
                info: 'inline math',
                type: 'constant',
                boost: 98
            }),
            snippetCompletion('\\[${ }\\]', {
                label: '\\[ \\]',
                info: 'display math',
                type: 'constant',
                boost: 97
            })
        ]),
        // '(', '[', and '{' are removed from this list because they interfere with the above snippets.
        closeBrackets: { brackets: ["'", '"'] }
    })
};
