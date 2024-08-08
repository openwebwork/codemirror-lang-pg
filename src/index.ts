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
                'package use no import': t.moduleKeyword,
                'constant feature lib subs async': t.modifier,
                'abs alarm atan2 await caller chdir chomp chop chmod chown chr chroot close': t.function(t.keyword),
                'closedir cos defined delete die each eof Eval evalbytes exec exists exit exp': t.function(t.keyword),
                'fcntl fileno flock fork getc gethostbyname getnetbyname getpgrp getpid': t.function(t.keyword),
                'getpriority getprotobyname glob gmtime gmtime grep hex int ioctl join keys': t.function(t.keyword),
                'kill lc lcfirst length link localtime lock log lstat map mkdir oct open': t.function(t.keyword),
                'opendir ord pack pipe pop pos print printf push quotemeta rand read readdir': t.function(t.keyword),
                'readline readlink readpipe rename rewinddir ref reset reverse rindex rmdir say': t.function(t.keyword),
                'scalar seek seekdir select setpgrp setpriority shift sin sleep sort splice': t.function(t.keyword),
                'split sprintf sqrt srand stat substr symlink syscall sysopen sysread sysseek': t.function(t.keyword),
                'system syswrite tell telldir tie tied time times truncate uc ucfirst umask': t.function(t.keyword),
                'unlink unpack unshift untie utime values vec wait waitpid wantarray warn': t.function(t.keyword),
                'BEGIN CHECK END INIT UNITCHECK': t.processingInstruction,
                '__FILE__ __LINE__ __PACKAGE__ __SUB__ __END__ __DATA__': t.literal,
                undef: t.null,
                'ScalarVariable SpecialScalarVariable ArrayVariable HashVariable': t.variableName,
                'ArrayLength/Identifier Prototype Constant/Identifier': t.variableName,
                'PackageName/...': t.namespace,
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
                'CompareOp < lt gt le ge eq ne cmp': t.compareOperator,
                '=': t.definitionOperator,
                '$ $# @ % & DerefOp */%{ ArrayDereference/} HashDereference/}': t.derefOperator,
                'ConcatOp BindingOp RangeOp RefOp': t.operator,
                Comment: t.lineComment,
                Integer: t.integer,
                Float: t.float,
                'StringSingleQuoted StringDoubleQuoted q qq qx */StringContent */InterpolatedStringContent': t.string,
                '*/QuoteLikeStartDelimiter QuoteLikeSeparatorDelimiter */QuoteLikeEndDelimiter': t.string,
                'qw QWListContent/... Pair/Identifier HashAccessVariable/Identifier': t.string,
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
