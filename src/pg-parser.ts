import { defineLanguageFacet, languageDataProp, syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import { completeFromList, snippetCompletion } from '@codemirror/autocomplete';
import type { SyntaxNode } from '@lezer/common';
import { parser } from './pg.grammar';
import { pgVariables, pgOperators, pgOperatorCompletions } from './pg-variables';

export const pgCompletion = (isTop = false) => {
    return (context: CompletionContext) => {
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

        if (isTop) {
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
        }

        if (context.matchBefore(/\$\w*$/)) {
            return completeFromList(
                Array.from(pgVariables.values()).map((label) => ({ label: `$${label}`, type: 'variable' }))
            )(context);
        }

        const completionOptions: Completion[] = [];

        if (
            isTop &&
            !inside([
                'InterpolatedHeredocBody',
                'UninterpolatedHeredocBody',
                'PodStatement',
                'EndDataStatement',
                'EndDocument'
            ]) &&
            ((context.matchBefore(/^\s*\w*/) && context.explicit) || context.matchBefore(/^\s*B\w*/))
        ) {
            completionOptions.push(
                ...['PGML', 'PGML_HINT', 'PGML_SOLUTION', 'TEXT', 'HINT', 'SOLUTION'].map((t, i) =>
                    snippetCompletion(`BEGIN_${t}\n\${}\nEND_${t}`, {
                        label: `BEGIN_${t}`,
                        type: 'type',
                        boost: 99 - i
                    })
                )
            );
        }

        if (
            inside(['CallExpression', 'FunctionName', 'Identifier']) &&
            !inside(['StringSingleQuoted', 'StringQQuoted', 'InterpolatedStringContent', 'UninterpolatedHeredocBody'])
        ) {
            for (const operator of pgOperators.values()) {
                const completions = pgOperatorCompletions.get(operator);
                if (completions) {
                    for (const template of completions) {
                        completionOptions.push(
                            snippetCompletion(template, {
                                label: operator,
                                info: template
                                    .replaceAll(/\${([^}]*)}/g, '$1')
                                    .replaceAll(/\t/g, '')
                                    .replaceAll(/\n/g, ' '),
                                type: 'variable',
                                section: { name: 'PG Methods' }
                            })
                        );
                    }
                } else {
                    completionOptions.push(
                        snippetCompletion(`${operator}(\${})\${}`, {
                            label: operator,
                            info: `${operator}()`,
                            type: 'variable',
                            section: { name: 'PG Methods' }
                        })
                    );
                }
            }
        }

        return completeFromList(completionOptions)(context);
    };
};

export const pgPerlParser = parser.configure({
    props: [languageDataProp.add({ Program: defineLanguageFacet({ autocomplete: pgCompletion() }) })]
});
