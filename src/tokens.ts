import type { InputStream } from '@lezer/lr';
import { ContextTracker, ExternalTokenizer } from '@lezer/lr';
import {
    automaticSemicolon,
    UnrestrictedIdentifier,
    FileTestOp,
    IOOperatorStart,
    Glob,
    ReadonlySTDIN,
    IOOperatorEnd,
    SpecialScalarVariable,
    NamedUnaryOperator,
    ListOperator,
    HeredocStartIdentifier,
    uninterpolatedHeredocStart,
    interpolatedHeredocStart,
    HeredocEndIdentifier,
    InterpolatedStringContent,
    EscapeSequence,
    afterInterpolation,
    QuoteLikeStartDelimiter,
    QuoteLikeSeparatorDelimiter,
    QuoteLikeEndDelimiter,
    StringContent,
    QWElement,
    patternMatchStart,
    RegexOptions,
    regexEnd,
    podBlock,
    endDataBlock,
    m,
    q,
    qq,
    qr,
    qw,
    qx,
    s,
    tr,
    y,
    Prototype,
    PackageName
} from './parser.terms.js';

const isUpperCaseASCIILetter = (ch: number) => ch >= 65 && ch <= 90;
const isLowerCaseASCIILetter = (ch: number) => ch >= 97 && ch <= 122;
const isASCIILetter = (ch: number) => isLowerCaseASCIILetter(ch) || isUpperCaseASCIILetter(ch);
const isDigit = (ch: number) => ch >= 48 && ch <= 55;

const isIdentifierChar = (ch: number) => ch == 95 /* '_' */ || isASCIILetter(ch) || isDigit(ch);
const isVariableStartChar = (ch: number) => ch == 95 /* '_' */ || isASCIILetter(ch);
const isRegexOptionChar = (ch: number, regexType: number) => {
    if (regexType === tr || regexType === y) {
        if (ch == 99 /* 'c' */ || ch == 100 /* 'd' */ || ch == 115 /* 's' */ || ch == 114 /* 'r' */) return true;
        return false;
    }

    if (
        ch == 109 /* 'm' */ ||
        ch == 115 /* 's' */ ||
        ch == 105 /* 'i' */ ||
        ch == 120 /* 'x' */ ||
        ch == 112 /* 'p' */ ||
        ch == 111 /* 'o' */ ||
        ch == 100 /* 'd' */ ||
        ch == 117 /* 'u' */ ||
        ch == 97 /* 'a' */ ||
        ch == 108 /* 'l' */ ||
        ch == 110 /* 'n' */
    )
        return true;

    if ((regexType === m || regexType == s) && (ch == 103 /* 'g' */ || ch == 99) /* 'c' */) return true;
    if (regexType == s && (ch == 101 /* 'e' */ || ch == 114) /* 'r' */) return true;

    return false;
};
// !"$%&'()*+,-./0123456789:;<=>?@[\]`~
const isSpecialVariableChar = (ch: number) =>
    (ch >= 33 && ch != 35 && ch <= 64) || ch == 91 || ch == 92 || ch == 93 || ch == 96 || ch == 126;

/* 0-9, a-f, A-F */
const isHex = (ch: number) => (ch >= 48 && ch <= 55) || (ch >= 97 && ch <= 102) || (ch >= 65 && ch <= 70);

// ' ', \t, \n, \r
const isWhitespace = (ch: number) => ch === 32 || ch === 9 || ch === 10 || ch === 13;

const gobbleWhitespace = (input: InputStream) => {
    while (isWhitespace(input.next)) input.advance();
};

// rwxoRWXOezsfdlpSbctugkTBMAC
const isFileTestOperatorChar = (ch: number) =>
    ch == 114 ||
    ch == 119 ||
    ch == 120 ||
    ch == 111 ||
    ch == 82 ||
    ch == 87 ||
    ch == 88 ||
    ch == 79 ||
    ch == 101 ||
    ch == 122 ||
    ch == 115 ||
    ch == 102 ||
    ch == 100 ||
    ch == 108 ||
    ch == 112 ||
    ch == 83 ||
    ch == 98 ||
    ch == 99 ||
    ch == 116 ||
    ch == 117 ||
    ch == 103 ||
    ch == 107 ||
    ch == 84 ||
    ch == 66 ||
    ch == 77 ||
    ch == 65 ||
    ch == 67;

type ContextType = 'quote' | 'quoteLike' | 'regex' | 'quoteLike&regex' | 'heredoc' | 'iooperator';

// Base class that all tracker contexts extend.
class Context {
    type: ContextType;

    // Used by quote and quoteLike operators.
    startDelimiter?: number;
    endDelimiter?: number;

    // Used by quoteLike operators.
    quoteLikeType?: number;
    nestLevel = 0;

    // Used by heredocs.
    tag?: number[];
    indented = false;
    inBody = false;

    // Used by any interpolating context.
    interpolating = false;

    constructor(
        type: ContextType,
        options: {
            startDelimiter?: number;
            quoteLikeType?: number;
            tag?: number[];
            interpolating?: boolean;
            indented?: boolean;
        } = {}
    ) {
        this.type = type;
        this.quoteLikeType = options.quoteLikeType;
        this.interpolating = options.interpolating ?? true;
        this.indented = options.indented ?? false;
        if (options.tag) this.tag = options.tag;
        if (typeof options.startDelimiter === 'number') this.setStartAndEndDelimiters(options.startDelimiter);
    }

    setStartAndEndDelimiters(start: number) {
        this.startDelimiter = start;
        if (start === 40 /* '(' */) {
            this.endDelimiter = 41 /* ')' */;
        } else if (start === 60 /* '<' */) {
            this.endDelimiter = 62 /* '>' */;
        } else if (start === 91 /* '[' */) {
            this.endDelimiter = 93 /* ']' */;
        } else if (start === 123 /* '{' */) {
            this.endDelimiter = 125 /* '}' */;
        } else this.endDelimiter = start;
    }

    atEnd(input: InputStream) {
        if (this.type === 'heredoc') {
            if (!this.tag || input.peek(-1) !== 10) return false;
            let pos = 0;
            if (this.indented) {
                let nextChar = input.peek(pos);
                while (isWhitespace(nextChar)) nextChar = input.peek(++pos);
            }
            for (const tagCh of this.tag) {
                if (input.peek(pos++) !== tagCh) return false;
            }
            if (input.peek(pos) < 0 || input.peek(pos) === 10) return pos;
            return false;
        } else {
            return input.next === this.endDelimiter ? 1 : false;
        }
    }
}

const contextStack: Context[] = [];
// FIXME: This is some annoying thing that Lezer does.  I believe that due ambiguity markers in the grammar the heredoc
// external tokenizer can be called twice with the same input.  So this lastTerm is a protection against a second
// context from being pushed onto the contextStack for the same input.
let lastTerm = -1;

export const contextTracker = new ContextTracker<Context | null>({
    start: null,
    shift(context, term, _stack, input) {
        if (lastTerm === term) return context;
        lastTerm = term;

        if (term === q || term === qq || term === qx || term === qw) {
            if (context) contextStack.push(context);
            return new Context('quoteLike', { quoteLikeType: term });
        } else if (term === m || term === qr || term === s || term === tr || term === y) {
            if (context) contextStack.push(context);
            return new Context('quoteLike&regex', { quoteLikeType: term });
        } else if (term === IOOperatorStart) {
            if (context) contextStack.push(context);
            return new Context('iooperator');
        } else if (term === HeredocStartIdentifier) {
            let pos = 0;
            const indented = input.next == 126; /* '~' */
            if (indented) ++pos;
            let haveWhitespace = false;
            while (isWhitespace(input.peek(pos))) {
                haveWhitespace = true;
                ++pos;
            }
            const quote =
                input.peek(pos) === 39 /* "'" */ || input.peek(pos) === 34 /* '"' */ || input.peek(pos) === 96 /* "`" */
                    ? input.peek(pos)
                    : undefined;
            if (!quote && haveWhitespace) return context;
            if (quote) ++pos;
            if (!isIdentifierChar(input.peek(pos))) return context;
            const tag = [input.peek(pos++)];
            for (;;) {
                const next = input.peek(pos++);
                if (!isIdentifierChar(next)) break;
                tag.push(next);
            }
            if (context) {
                // FIXME: THis needs more thought. I believe that it is not so simple as the new context needing to go
                // onto the beginning or end of the stack. I am rather certain there are cases where the context will
                // need to be more precisely positioned in the stack.
                if (context.type === 'heredoc' && context.inBody) {
                    contextStack.push(context);
                    return new Context('heredoc', {
                        tag,
                        interpolating: !quote || quote === 34 || quote === 96,
                        indented
                    });
                } else {
                    contextStack.unshift(
                        new Context('heredoc', { tag, interpolating: !quote || quote === 34 || quote === 96, indented })
                    );
                }
                return context;
            } else {
                return new Context('heredoc', { tag, interpolating: !quote || quote === 34 || quote === 96, indented });
            }
        } else if (term === patternMatchStart) {
            let pos = 0;
            let next;
            while (isWhitespace((next = input.peek(pos)))) ++pos;
            if (next == 47 /* '/' */) {
                if (context) contextStack.push(context);
                return new Context('regex', { startDelimiter: 47, quoteLikeType: m });
            }
        } else if (
            !context ||
            ((context.type !== 'quote' || input.next != context.endDelimiter) && term !== InterpolatedStringContent)
        ) {
            if (input.next == 34 /* '"' */ || input.next === 96 /* '`' */) {
                if (context) contextStack.push(context);
                return new Context('quote', { startDelimiter: input.next });
            }
        }

        if (!(context instanceof Context)) return context;

        if (context.type.startsWith('quoteLike') && term === QuoteLikeStartDelimiter) {
            let pos = 1;
            let startDelimiter = input.next;
            while (isWhitespace(startDelimiter)) startDelimiter = input.peek(pos++);
            if (input.next >= 0) {
                context.setStartAndEndDelimiters(startDelimiter);
                // Note that q and qw are not interpolated, but don't need to set this because they can't accept
                // interpolated content.
                if (
                    context.quoteLikeType === tr ||
                    context.quoteLikeType === y ||
                    ((context.quoteLikeType === m ||
                        context.quoteLikeType === qr ||
                        context.quoteLikeType === qx ||
                        context.quoteLikeType === s) &&
                        startDelimiter === 39) /* "'" */
                )
                    context.interpolating = false;
                return context;
            }
        }

        if (context.type === 'heredoc' && (term === interpolatedHeredocStart || term === uninterpolatedHeredocStart))
            context.inBody = true;

        if (
            (context.type === 'quote' && input.next === context.endDelimiter) ||
            (context.type === 'quoteLike' && term === QuoteLikeEndDelimiter) ||
            (context.type === 'regex' && term === regexEnd) ||
            (context.type === 'quoteLike&regex' && term === regexEnd) ||
            term === HeredocEndIdentifier ||
            term === IOOperatorEnd
        ) {
            return contextStack.pop() ?? null;
        }

        return context;
    }
});

export const semicolon = new ExternalTokenizer((input, stack) => {
    if (
        stack.canShift(automaticSemicolon) &&
        input.next !== 59 /* ';' */ &&
        (input.next < 0 || input.next === 125) /* '}' */
    )
        input.acceptToken(automaticSemicolon);
});

export const unrestrictedIdentifier = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(UnrestrictedIdentifier)) {
        gobbleWhitespace(input);
        if (input.next < 0 || isASCIILetter(input.next) || input.next === 95 /* _ */) return;
        while (input.next >= 0 && isIdentifierChar(input.next)) input.advance();
        input.acceptToken(UnrestrictedIdentifier);
    }
});

// Note that is only to pick up special variables that won't be considered as a ScalarVariable already.
// FIXME: For now special scalar variables are skipped when interpolating. They shouldn't be.
export const specialScalarVariable = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(SpecialScalarVariable) && input.next == 36 /* '$' */ && !stack.context) {
        if (stack.canShift(Prototype)) return;
        const first = input.peek(1);
        const second = input.peek(2);
        if (first == 123 /* '{' */ && isSpecialVariableChar(second) && input.peek(3) == 125 /* '}' */) {
            input.acceptToken(SpecialScalarVariable, 4);
            return;
        }
        if (first == 123 /* '{' */ && second == 94 /* '^' */) {
            let pos = 3,
                ch;
            while ((isUpperCaseASCIILetter((ch = input.peek(pos))) || ch == 95) /* '_' */ && ch != 125 /* '}' */) ++pos;
            if (ch == 125) {
                input.acceptToken(SpecialScalarVariable, pos + 1);
                return;
            }
        }
        if (first == 94 /* '^' */ && (isUpperCaseASCIILetter(second) || second == 95) /* '_' */) {
            input.acceptToken(SpecialScalarVariable, 3);
            return;
        }
        if (!isSpecialVariableChar(first)) return;
        if (first == 36 /* '$' */ && isIdentifierChar(second)) return;
        input.acceptToken(SpecialScalarVariable, 2);
        return;
    }
});

// Note that 'eval' and 'do' are not in this list as they can accept a block.
const namedUnaryOperators = [
    'abs',
    'alarm',
    'await',
    'caller',
    'chdir',
    'chr',
    'chroot',
    'close',
    'closedir',
    'cos',
    'defined',
    'delete',
    'eof',
    'evalbytes',
    'exists',
    'exit',
    'exp',
    'fileno',
    'getc',
    'gethostbyname',
    'getnetbyname',
    'getpgrp',
    'getprotobyname',
    'glob',
    'gmtime',
    'hex',
    'int',
    'lc',
    'lcfirst',
    'length',
    'localtime',
    'lock',
    'log',
    'lstat',
    'oct',
    'ord',
    'pos',
    'quotemeta',
    'rand',
    'readdir',
    'readline',
    'readlink',
    'readpipe',
    'reset',
    'rewinddir',
    'ref',
    'rmdir',
    'scalar',
    'select',
    'sin',
    'sleep',
    'sqrt',
    'srand',
    'stat',
    'tell',
    'telldir',
    'tied',
    'uc',
    'ucfirst',
    'umask',
    'undef',
    'untie'
];

// The list operators that can operate on a block (grep, map, join, sort, and unpack) are handled separately.
const listOperators = [
    'atan2',
    'chomp',
    'chop',
    'chmod',
    'chown',
    'crypt',
    'die',
    'fcntl',
    'flock',
    'getpriority',
    'index',
    'ioctl',
    'kill',
    'link',
    'mkdir',
    'open',
    'opendir',
    'pack',
    'pipe',
    'read',
    'rename',
    'reverse',
    'rindex',
    'seek',
    'seekdir',
    'setpgrp',
    'setpriority',
    'split',
    'sprintf',
    'substr',
    'symlink',
    'syscall',
    'sysopen',
    'sysread',
    'sysseek',
    'syswrite',
    'tie',
    'truncate',
    'unlink',
    'utime',
    'vec',
    'waitpid',
    'warn'
];

// Finds the longest lower case word coming up in the stream.  Returns an array
// containing the word and the ascii character code of the next character after it.
const peekLCWord = (input: InputStream): [string, number] => {
    let pos = 0;
    let word = '',
        nextChar: number;
    while (isLowerCaseASCIILetter((nextChar = input.peek(pos)))) {
        ++pos;
        word += String.fromCharCode(nextChar);
    }
    return [word, nextChar];
};

export const builtinOperator = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(NamedUnaryOperator)) {
        const [word, nextChar] = peekLCWord(input);
        if (namedUnaryOperators.includes(word) && !isIdentifierChar(nextChar))
            input.acceptToken(NamedUnaryOperator, word.length);
    }

    if (stack.canShift(ListOperator)) {
        const [word, nextChar] = peekLCWord(input);
        if (listOperators.includes(word) && !isIdentifierChar(nextChar)) input.acceptToken(ListOperator, word.length);
    }
});

export const fileIO = new ExternalTokenizer(
    (input, stack) => {
        if (stack.canShift(FileTestOp) && !stack.canShift(PackageName)) {
            gobbleWhitespace(input);
            if (input.next == 45 /* '-' */ && isFileTestOperatorChar(input.peek(1)) && !isASCIILetter(input.peek(2)))
                input.acceptToken(FileTestOp, 2);
        }

        if (
            stack.canShift(IOOperatorStart) &&
            input.next == 60 /* '<' */ &&
            (input.peek(1) != 60 || (input.peek(2) == 62 && input.peek(3) == 62))
        ) {
            input.acceptToken(IOOperatorStart, 1);
            return;
        }

        if (!(stack.context instanceof Context) || stack.context.type !== 'iooperator') return;
        if (stack.canShift(IOOperatorEnd) && input.next == 62 /* '>' */) {
            input.acceptToken(IOOperatorEnd, 1);
            return;
        }
        if (input.peek(0) == 60 && input.peek(1) == 62 && input.peek(2) === 62) {
            input.acceptToken(ReadonlySTDIN, 2);
            return;
        }

        let pos = 0,
            ch: number;
        const isPossibleVariable = input.next == 36; /* '$' */
        if (isPossibleVariable) ++pos;
        let haveWhitespace = false,
            haveNonASCII = false;
        while ((ch = input.peek(pos)) >= 0 && ch != 62 /* '>' */) {
            if (isWhitespace(ch)) haveWhitespace = true;
            if (!isASCIILetter(ch)) haveNonASCII = true;
            ++pos;
        }
        if (
            (isPossibleVariable && !haveWhitespace && !haveNonASCII) ||
            (!isPossibleVariable && !haveWhitespace && !haveNonASCII) ||
            ch < 0
        )
            return;

        input.acceptToken(Glob, pos);
    },
    { contextual: true }
);

export const heredoc = new ExternalTokenizer(
    (input, stack) => {
        if (stack.canShift(HeredocStartIdentifier)) {
            const indented = input.next == 126; /* '~' */
            if (indented) input.advance();
            gobbleWhitespace(input);
            const quote =
                input.next == 39 /* "'" */ || input.next == 34 /* '"' */ || input.next === 96 /* "`" */
                    ? input.next
                    : undefined;
            if (!quote && isWhitespace(input.peek(-1))) return;
            if (quote) input.advance();
            if (!isIdentifierChar(input.next)) return;
            for (;;) {
                input.advance();
                if (!isIdentifierChar(input.next)) break;
            }
            if (quote) {
                if (input.next != quote) return;
                input.advance();
            }
            input.acceptToken(HeredocStartIdentifier);
            return;
        }
        if (!(stack.context instanceof Context) || stack.context.type !== 'heredoc') return;
        if (
            (stack.canShift(uninterpolatedHeredocStart) || stack.canShift(interpolatedHeredocStart)) &&
            !stack.context.inBody &&
            input.next === 10 /* '\n' */
        ) {
            if (stack.context.interpolating) input.acceptToken(interpolatedHeredocStart);
            else input.acceptToken(uninterpolatedHeredocStart);
            return;
        } else if (stack.context.tag) {
            if (stack.context.interpolating) {
                const endCount = stack.context.atEnd(input);
                if (endCount) {
                    input.acceptToken(HeredocEndIdentifier, endCount);
                    return;
                } else if (input.next < 0) {
                    input.acceptToken(HeredocEndIdentifier);
                    return;
                }
            } else {
                const endCount = stack.context.atEnd(input);
                if (endCount) {
                    input.acceptToken(HeredocEndIdentifier, endCount);
                    return;
                }

                for (;;) {
                    if (input.next < 0) {
                        input.acceptToken(HeredocEndIdentifier);
                        return;
                    }
                    if (input.next != 10 /* '\n' */) {
                        input.advance();
                        continue;
                    }
                    input.advance();
                    const endCount = stack.context.atEnd(input);
                    if (endCount) {
                        input.acceptToken(StringContent);
                        return;
                    }
                    input.advance();
                }
            }
        }
    },
    { contextual: true }
);

const scanEscape = (input: InputStream) => {
    const after = input.peek(1);

    // Restricted range octal character
    if (after >= 48 && after <= 55 /* '0'-'7' */) {
        let size = 2,
            next;
        while (size < 5 && (next = input.peek(size)) >= 48 && next <= 55) ++size;
        return size;
    }

    // Restricted range hexidecimal character
    if (after === 120 /* 'x' */ && isHex(input.peek(2))) return isHex(input.peek(3)) ? 4 : 3;

    // Hexidecimal character
    if (after === 120 /* 'x' */ && input.peek(2) === 123 /* '{' */) {
        // FIXME: There could be optional blanks at the beginning and end inside the braces.
        for (let size = 3; ; ++size) {
            const next = input.peek(size);
            if (next == 125 /* '}' */) return size + 1;
            if (!isHex(next)) break;
        }
    }

    // This could be any named unicode character or character sequence.
    if (after === 78 /* 'N' */ && input.peek(2) === 123 /* '{' */) {
        for (let size = 3; ; ++size) {
            const next = input.peek(size);
            if (next == 125 /* '}' */) return size + 1;
            if (next < 0) break;
        }
    }

    // Octal character
    if (after === 111 /* 'o' */ && input.peek(2) === 123 /* '{' */) {
        for (let size = 3; ; ++size) {
            const next = input.peek(size);
            if (next == 125 /* '}' */) return size + 1;
            if (next < 48 || next > 55 /* not '0'-'7' */) break;
        }
    }

    return 2;
};

export const interpolated = new ExternalTokenizer(
    (input, stack) => {
        if (!(stack.context instanceof Context) || !stack.context.interpolating) return;
        let content = false;
        for (; ; content = true) {
            if (
                (stack.context.nestLevel === 0 && stack.context.atEnd(input)) ||
                input.next < 0 ||
                ((input.next == 36 /* '$' */ || input.next == 64) /* '@' */ &&
                    (isVariableStartChar(input.peek(1)) || input.peek(1) == 123)) /* '{' */
            ) {
                break;
            } else if (
                stack.context.type.startsWith('quoteLike') &&
                stack.context.startDelimiter !== stack.context.endDelimiter &&
                input.next === stack.context.startDelimiter
            ) {
                ++stack.context.nestLevel;
            } else if (stack.context.nestLevel > 0 && input.next === stack.context.endDelimiter) {
                --stack.context.nestLevel;
            } else if (input.next == 92 /* '\\' */) {
                const escaped = scanEscape(input);
                if (escaped) {
                    if (content) break;
                    else {
                        input.acceptToken(EscapeSequence, escaped);
                        return;
                    }
                }
            } else if (
                !content &&
                (input.next === 91 /* '[' */ ||
                    input.next === 123 /* '{' */ ||
                    (input.next === 45 /* '-' */ &&
                        input.peek(1) === 62 /* '>' */ &&
                        (input.peek(2) === 91 /* '[' */ || input.peek(2) === 123))) /* '{' */ &&
                stack.canShift(afterInterpolation)
            ) {
                break;
            }
            input.advance();
        }
        if (content) input.acceptToken(InterpolatedStringContent);
    },
    { contextual: true }
);

// Note that the paired delimiters enabled by the extra_paired_delimiters
// feature are not dealt with by the quote-like tokenizers.
export const quoteLikeOperator = new ExternalTokenizer(
    (input, stack) => {
        if (!(stack.context instanceof Context) || !stack.context.type.startsWith('quoteLike')) return;

        if (!stack.context.startDelimiter) {
            const haveWhitespace = isWhitespace(input.next);
            let pos = 1;
            let nextChar = input.next;
            while (isWhitespace(nextChar)) nextChar = input.peek(pos++);

            if (stack.canShift(QuoteLikeStartDelimiter) && nextChar >= 0 && (!haveWhitespace || nextChar !== 35)) {
                input.acceptToken(QuoteLikeStartDelimiter, pos);
                return;
            }

            return;
        }

        if (stack.canShift(QWElement) && isWhitespace(input.next)) gobbleWhitespace(input);

        if (
            stack.canShift(QuoteLikeSeparatorDelimiter) &&
            stack.context.startDelimiter === stack.context.endDelimiter &&
            input.next === stack.context.endDelimiter
        ) {
            input.acceptToken(QuoteLikeSeparatorDelimiter, 1);
            return;
        } else if (
            stack.canShift(QuoteLikeEndDelimiter) &&
            stack.context.type === 'quoteLike&regex' &&
            stack.context.startDelimiter !== stack.context.endDelimiter &&
            input.next === stack.context.endDelimiter
        ) {
            input.acceptToken(QuoteLikeEndDelimiter, 1);
            return;
        }

        if (
            stack.canShift(QuoteLikeStartDelimiter) &&
            stack.context.type === 'quoteLike&regex' &&
            stack.context.startDelimiter !== stack.context.endDelimiter
        ) {
            let pos = 1;
            let nextChar = input.next;
            while (isWhitespace(nextChar)) nextChar = input.peek(pos++);
            if (nextChar === stack.context.startDelimiter) {
                input.acceptToken(QuoteLikeStartDelimiter, pos);
                return;
            }
        }

        if (input.next === stack.context.endDelimiter) {
            input.acceptToken(QuoteLikeEndDelimiter, 1);
            return;
        }

        if (input.next >= 0) {
            if (stack.canShift(StringContent)) {
                while (
                    input.next >= 0 &&
                    (stack.context.nestLevel > 0 ||
                        input.next !== stack.context.endDelimiter ||
                        (input.next === stack.context.endDelimiter && input.peek(-1) == 92))
                ) {
                    if (stack.context.startDelimiter !== stack.context.endDelimiter) {
                        if (input.next === stack.context.startDelimiter) ++stack.context.nestLevel;
                        if (input.next === stack.context.endDelimiter) --stack.context.nestLevel;
                    }
                    input.advance();
                }
                input.acceptToken(StringContent);
                return;
            } else if (stack.canShift(QWElement)) {
                while (
                    input.next >= 0 &&
                    !isWhitespace(input.next) &&
                    (stack.context.nestLevel > 0 ||
                        input.next !== stack.context.endDelimiter ||
                        (input.next === stack.context.endDelimiter && input.peek(-1) == 92))
                ) {
                    if (stack.context.startDelimiter !== stack.context.endDelimiter) {
                        if (input.next === stack.context.startDelimiter) ++stack.context.nestLevel;
                        if (input.next === stack.context.endDelimiter) --stack.context.nestLevel;
                    }
                    input.advance();
                }
                input.acceptToken(QWElement);
                return;
            }
        }
    },
    { contextual: true }
);

export const regex = new ExternalTokenizer(
    (input, stack) => {
        if (stack.canShift(patternMatchStart)) {
            gobbleWhitespace(input);
            if (input.next == 47 /* '/' */) input.acceptToken(patternMatchStart);
        }

        if (!(stack.context instanceof Context) || !stack.context.type.endsWith('regex')) return;

        if (
            stack.canShift(RegexOptions) &&
            stack.context.quoteLikeType &&
            isRegexOptionChar(input.next, stack.context.quoteLikeType)
        ) {
            while (input.next >= 0 && isRegexOptionChar(input.next, stack.context.quoteLikeType)) input.advance();
            input.acceptToken(RegexOptions);
            return;
        }

        if (stack.canShift(regexEnd)) {
            input.acceptToken(regexEnd);
            return;
        }
    },
    { contextual: true }
);

export const podStatement = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(podBlock)) {
        if (
            (input.peek(-1) == 10 /* '\n' */ || input.peek(-1) < 0) &&
            input.next == 61 /* '=' */ &&
            isASCIILetter(input.peek(1))
        ) {
            let current = input.advance(2);
            while (current >= 0) {
                if (current != 10) {
                    current = input.advance();
                    continue;
                }
                if (
                    (current = input.advance()) == 61 /* '=' */ &&
                    (current = input.advance()) == 99 /* 'c' */ &&
                    (current = input.advance()) == 117 /* 'u' */ &&
                    (current = input.advance()) == 116 /* 't' */ &&
                    ((current = input.advance()) == 10 || current < 0)
                )
                    break;
            }
            input.acceptToken(podBlock);
        }
    }
});

export const endData = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(endDataBlock)) {
        while (input.advance() >= 0);
        input.acceptToken(endDataBlock);
    }
});
