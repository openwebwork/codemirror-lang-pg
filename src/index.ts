import { parser } from './perl.grammar';
import {
    LRLanguage,
    LanguageSupport,
    indentNodeProp,
    continuedIndent,
    foldNodeProp,
    foldInside,
    delimitedIndent
} from '@codemirror/language';
import { styleTags, tags as t } from '@lezer/highlight';
import { completeFromList } from '@codemirror/autocomplete';

export const perlLanguage = LRLanguage.define({
    name: 'perl',
    parser: parser.configure({
        props: [
            indentNodeProp.add({
                IfStatement: continuedIndent({ except: /^\s*({|else\b|elsif\b)/ }),
                Block: delimitedIndent({ closing: '}' }),
                String: () => null,
                Statement: continuedIndent()
            }),
            foldNodeProp.add({ 'Block Array ArrayRef HashRef': foldInside }),
            styleTags({
                'do continue else elsif for foreach goto if last next redo return unless until when while':
                    t.controlKeyword,
                'bless local my our state sub': t.definitionKeyword,
                'package use no import require parent base': t.moduleKeyword,
                'constant feature lib subs async prototype': t.modifier,
                'NamedUnaryOperator ListOperator Eval each exec fork getpid grep': t.function(t.keyword),
                'join keys map pop print printf push say shift sort splice system time times': t.function(t.keyword),
                'unpack unshift values wait wantarray': t.function(t.keyword),
                'BEGIN CHECK END INIT UNITCHECK': t.processingInstruction,
                '__FILE__ __LINE__ __PACKAGE__ __SUB__ __END__ __DATA__': t.literal,
                'ScalarVariable SpecialScalarVariable ArrayVariable HashVariable': t.variableName,
                'ArrayLength/Identifier Prototype Constant/Identifier': t.variableName,
                'PackageName/... SUPER': t.namespace,
                'NamedType/...': t.typeName,
                Name: t.name,
                'Label/Identifier LabelName/Identifier STDIN STDERR STDOUT IOOperator/Identifier': t.labelName,
                'MemberExpression/Identifier': t.propertyName,
                'MemberExpression/ScalarVariable': t.special(t.propertyName),
                'FunctionName/PackageName/... FunctionName/Identifier': t.function(t.definition(t.variableName)),
                UpdateOp: t.updateOperator,
                'ArithOp % "/"': t.arithmeticOperator,
                'LogicOp and not or xor : FileTestOp': t.logicOperator,
                BitOp: t.bitwiseOperator,
                '<<': t.special(t.bitwiseOperator),
                'CompareOp < lt gt le ge eq ne cmp isa': t.compareOperator,
                '=': t.definitionOperator,
                '$ $# @ % & DerefOp */%{ ArrayDereference/} HashDereference/}': t.derefOperator,
                'ConcatOp BindingOp RangeOp RefOp x': t.operator,
                Comment: t.lineComment,
                Integer: t.integer,
                Float: t.float,
                'StringSingleQuoted StringDoubleQuoted q qq qx */StringContent */InterpolatedStringContent': t.string,
                '*/QuoteLikeStartDelimiter QuoteLikeSeparatorDelimiter */QuoteLikeEndDelimiter': t.string,
                'qw QWListContent/... Pair/Identifier HashAccessVariable/Identifier Version': t.string,
                'HeredocInitializer/... Heredoc UninterpolatedHeredocBody HeredocEndIdentifier Glob': t.string,
                'm qr s tr y RegexOptions': t.special(t.string),
                PodStatement: t.blockComment,
                EscapeSequence: t.escape,
                'Comma FatComma': t.punctuation,
                '( )': t.paren,
                '->[ [ ]': t.squareBracket,
                '%{ ->{ { }': t.brace,
                'ArrowOperator \\': t.derefOperator,
                '; :: :': t.separator
            })
        ]
    }),
    languageData: { commentTokens: { line: '#' } }
});

export const perlCompletion = perlLanguage.data.of({
    autocomplete: completeFromList([
        { label: 'my', type: 'keyword' },
        { label: 'use', type: 'keyword' },
        { label: 'sub', type: 'keyword' }
    ])
});

export const perl = () => new LanguageSupport(perlLanguage, [perlCompletion]);
