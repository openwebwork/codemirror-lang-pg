import type { SyntaxNode } from '@lezer/common';
import { defineLanguageFacet, syntaxTree } from '@codemirror/language';
import type { CompletionContext } from '@codemirror/autocomplete';
import { snippetCompletion } from '@codemirror/autocomplete';

const perlCommandSnippet = snippetCompletion('\\\\{${ }\\\\}', {
    label: '\\{ \\}',
    info: 'perl command',
    type: 'constant',
    boost: 99
});

const inlineMathSnippet = snippetCompletion('\\(${ }\\)', {
    label: '\\( \\)',
    info: 'inline math',
    type: 'constant',
    boost: 98
});

const displayMathSnippet = snippetCompletion('\\[${ }\\]', {
    label: '\\[ \\]',
    info: 'display math',
    type: 'constant',
    boost: 97
});

export const pgTextLanguageData = {
    PGTextContent: defineLanguageFacet({
        autocomplete: (context: CompletionContext) => {
            const nodeAt = syntaxTree(context.state).resolveInner(context.pos, -1);
            const currentLine = context.state.doc.lineAt(context.pos);
            const textBefore = currentLine.text.slice(0, context.pos - currentLine.from);
            const textAfter = currentLine.text.slice(context.pos - currentLine.from);

            // This returns 2 if inside a complete node, 1 if inside an incomplete node, and false otherwise.
            const inside = (nodeNames: string | string[]) => {
                for (let pos: SyntaxNode | null = nodeAt; pos; pos = pos.parent) {
                    if ((nodeNames instanceof Array && nodeNames.includes(pos.name)) || nodeNames === pos.name)
                        return (pos.name === 'Comment' && !pos.lastChild) ||
                            (pos.name !== 'Comment' && pos.lastChild && pos.lastChild.name !== 'PGTextError')
                            ? 2
                            : 1;
                    if (pos.type.isTop) break;
                }
                return false;
            };

            if (inside('PerlCommand') === 2) return;

            const insideInlineMathMode = inside('InlineMathMode');
            const insideDisplayMathMode = inside('DisplayMathMode');
            if (
                insideInlineMathMode == 2 ||
                (insideInlineMathMode == 1 && (!textBefore.endsWith('\\(') || textAfter.startsWith('\\)'))) ||
                insideDisplayMathMode == 2 ||
                (insideDisplayMathMode == 1 && (!textBefore.endsWith('\\[') || textAfter.startsWith('\\]')))
            ) {
                const previous = context.matchBefore(/\\{?/);
                if (!previous && !context.explicit) return;
                return {
                    from: previous?.from ?? context.pos,
                    options: [perlCommandSnippet]
                };
            }

            const previous = context.matchBefore(/\\[{([]?/);
            if (!previous && !context.explicit) return;

            return {
                from: previous?.from ?? context.pos,
                options: [perlCommandSnippet, inlineMathSnippet, displayMathSnippet]
            };
        },
        // '(', '[', and '{' are removed from this list because they interfere with the above snippets.
        closeBrackets: { brackets: ["'", '"'] }
    })
};
