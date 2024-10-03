import type { InputStream } from '@lezer/lr';
import { ContextTracker, ExternalTokenizer } from '@lezer/lr';
import { namedUnaryOperators, listOperators } from './operators';
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
    LaTeXImageCodeStart,
    uninterpolatedHeredocStart,
    interpolatedHeredocStart,
    HeredocEndIdentifier,
    InterpolatedStringContent,
    EscapeSequence,
    afterInterpolation,
    packageNamePart,
    afterPackageName,
    QuoteLikeStartDelimiter,
    QuoteLikeSeparatorDelimiter,
    QuoteLikeEndDelimiter,
    StringContent,
    QWElement,
    patternMatchStart,
    RegexOptions,
    regexEnd,
    PodDirective,
    PodContent,
    PodCut,
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
    PackageName,
    BeginPG,
    PGMLContent,
    PGTextContent,
    EndPG
} from './pg.grammar.terms.js';
import {
    isHWhitespace,
    isWhitespace,
    isUpperCaseASCIILetter,
    isLowerCaseASCIILetter,
    isASCIILetter,
    isIdentifierChar,
    isVariableStartChar,
    isSpecialVariableChar,
    isHex,
    isFileTestOperatorChar
} from './text-utils';

const isRegexOptionChar = (ch: number, regexType: number) => {
    if (regexType === tr || regexType === y) {
        if (ch == 99 /* c */ || ch == 100 /* d */ || ch == 115 /* s */ || ch == 114 /* r */) return true;
        return false;
    }

    if (
        ch == 109 /* m */ ||
        ch == 115 /* s */ ||
        ch == 105 /* i */ ||
        ch == 120 /* x */ ||
        ch == 112 /* p */ ||
        ch == 111 /* o */ ||
        ch == 100 /* d */ ||
        ch == 117 /* u */ ||
        ch == 97 /* a */ ||
        ch == 108 /* l */ ||
        ch == 110 /* n */
    )
        return true;

    if ((regexType === m || regexType === s) && (ch == 103 /* g */ || ch == 99) /* c */) return true;
    if (regexType == s && (ch == 101 /* e */ || ch == 114) /* r */) return true;

    return false;
};

const gobbleWhitespace = (input: InputStream) => {
    while (isWhitespace(input.next)) input.advance();
};

const beginPGPrefix = [66, 69, 71, 73, 78, 95]; // BEGIN_
const pgVariants = [
    [80, 71, 77, 76, 95, 72, 73, 78, 84], // PGML_HINT
    [80, 71, 77, 76, 95, 83, 79, 76, 85, 84, 73, 79, 78], // PGML_SOLUTION
    [80, 71, 77, 76], // PGML
    [84, 69, 88, 84], // TEXT
    [72, 73, 78, 84], // HINT
    [83, 79, 76, 85, 84, 73, 79, 78] // SOLUTION
];
const endPGPrefix = [69, 78, 68, 95]; // END_
const tikz = [84, 73, 75, 90]; // TIKZ
const latexImage = [76, 65, 84, 69, 88, 95, 73, 77, 65, 71, 69]; // LATEX_IMAGE

type ContextType = 'root' | 'quote' | 'quoteLike' | 'regex' | 'quoteLike&regex' | 'heredoc' | 'iooperator' | 'pg';

const heredocQueue: Context[] = [];

// Base class that all tracker contexts extend.
class Context {
    type: ContextType;
    parent: Context | null;
    stackPos: number;

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
    newlinePos?: number;

    // Used by any interpolating context.
    interpolating = false;

    constructor(
        type: ContextType,
        parent: Context | null = null,
        stackPos = -1,
        options: {
            startDelimiter?: number;
            quoteLikeType?: number;
            tag?: number[];
            interpolating?: boolean;
            indented?: boolean;
            newlinePos?: number;
        } = {}
    ) {
        this.type = type;
        this.parent = parent;
        this.stackPos = stackPos;
        this.quoteLikeType = options.quoteLikeType;
        this.interpolating = options.interpolating ?? true;
        this.indented = options.indented ?? false;
        if (options.tag) this.tag = options.tag;
        if (typeof options.startDelimiter === 'number') this.setStartAndEndDelimiters(options.startDelimiter);
        if (typeof options.newlinePos === 'number') this.newlinePos = options.newlinePos;
    }

    setStartAndEndDelimiters(start: number) {
        this.startDelimiter = start;
        if (start == 40 /* ( */) {
            this.endDelimiter = 41 /* ) */;
        } else if (start == 60 /* < */) {
            this.endDelimiter = 62 /* > */;
        } else if (start == 91 /* [ */) {
            this.endDelimiter = 93 /* ] */;
        } else if (start == 123 /* { */) {
            this.endDelimiter = 125 /* } */;
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
            if (input.peek(pos) < 0 || input.peek(pos) == 10) return pos;
            return false;
        } else if (this.type === 'pg') {
            if (!this.tag || input.peek(-1) !== 10) return false;
            let pos = 0;
            let ch = input.peek(pos);
            while (isHWhitespace(ch)) ch = input.peek(++pos);
            for (const tagCh of this.tag) {
                if (ch !== tagCh) return false;
                ch = input.peek(++pos);
            }
            while (isHWhitespace(ch) || ch == 59 /* ; */) ch = input.peek(++pos);
            if (ch == 10 || ch < 0) return pos;
        } else {
            return input.next === this.endDelimiter ? 1 : false;
        }
    }
}

export const contextTracker = new ContextTracker<Context>({
    start: new Context('root'),
    shift(context, term, stack, input) {
        if (term === q || term === qq || term === qx || term === qw) {
            return new Context('quoteLike', context, stack.pos, { quoteLikeType: term });
        } else if (term === m || term === qr || term === s || term === tr || term === y) {
            return new Context('quoteLike&regex', context, stack.pos, { quoteLikeType: term });
        } else if (term === IOOperatorStart) {
            return new Context('iooperator', context);
        } else if (term === HeredocStartIdentifier) {
            let pos = 0;
            const indented = input.next == 126 && input.peek(1) != 126; /* ~ follows but not ~~ */
            if (indented) ++pos;
            let haveWhitespace = false;
            while (isWhitespace(input.peek(pos))) {
                haveWhitespace = true;
                ++pos;
            }
            const quote =
                input.peek(pos) == 39 /* ' */ || input.peek(pos) == 34 /* " */ || input.peek(pos) == 96 /* ` */
                    ? input.peek(pos)
                    : undefined;
            if (!quote && haveWhitespace) return context;
            if (quote) ++pos;
            const escapedTag = !quote && input.peek(pos) == 126 && input.peek(pos + 1) == 126; /* ~ */
            if (escapedTag) pos += 2;
            if (escapedTag && (haveWhitespace || isWhitespace(input.peek(pos)))) return context;
            if (!isIdentifierChar(input.peek(pos))) return context;
            const tag = [input.peek(pos++)];
            for (;;) {
                const next = input.peek(pos++);
                if (!isIdentifierChar(next)) break;
                tag.push(next);
            }
            if (heredocQueue[0]?.stackPos !== stack.pos) {
                while (input.peek(pos) != 10 /* \n */ && input.peek(pos) >= 0) ++pos;
                heredocQueue.unshift(
                    new Context('heredoc', context, stack.pos, {
                        tag,
                        interpolating: (!quote || quote == 34 || quote == 96) && !escapedTag,
                        indented,
                        newlinePos: input.pos + pos
                    })
                );
            }
            return context;
        } else if (term === LaTeXImageCodeStart) {
            let pos = 0;
            while (isHWhitespace(input.peek(pos))) ++pos;
            const isLatexImage = beginPGPrefix.concat(latexImage).every((l, index) => l == input.peek(pos + index));
            if (!isLatexImage && !beginPGPrefix.concat(tikz).every((l, index) => l == input.peek(pos + index)))
                return context;
            if (heredocQueue.at(-1)?.stackPos !== stack.pos) {
                while (input.peek(pos) != 10 /* \n */ && input.peek(pos) >= 0) ++pos;
                heredocQueue.unshift(
                    new Context('heredoc', context, stack.pos, {
                        tag: endPGPrefix.concat(isLatexImage ? latexImage : tikz),
                        interpolating: true,
                        newlinePos: input.pos + pos
                    })
                );
            }
            return context;
        } else if (term === patternMatchStart) {
            let pos = 0;
            let next;
            while (isWhitespace((next = input.peek(pos)))) ++pos;
            if (next == 47 /* / */) {
                return new Context('regex', context, stack.pos, { startDelimiter: 47, quoteLikeType: m });
            }
        } else if (term === BeginPG) {
            let pos = -1;
            while (isHWhitespace(input.peek(++pos)));

            if (!beginPGPrefix.every((l, index) => l == input.peek(pos + index))) return context;
            pos += beginPGPrefix.length;

            const pgVariant = pgVariants.findIndex((variant) =>
                variant.every((l, index) => l == input.peek(pos + index))
            );
            if (pgVariant === -1) return context;

            return new Context('pg', context, stack.pos, {
                tag: endPGPrefix.concat(pgVariants[pgVariant]),
                interpolating: false
            });
        } else if (
            (context.type !== 'quote' || input.next != context.endDelimiter) &&
            term !== InterpolatedStringContent &&
            context.type !== 'pg'
        ) {
            if (input.next == 34 /* " */ || input.next == 96 /* ` */) {
                return new Context('quote', context, stack.pos, { startDelimiter: input.next });
            }
        }

        if (context.type.startsWith('quoteLike') && term === QuoteLikeStartDelimiter) {
            let pos = 1;
            let startDelimiter = input.next;
            while (isWhitespace(startDelimiter)) startDelimiter = input.peek(pos++);
            if (startDelimiter >= 0) {
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
                        startDelimiter == 39) /* ' */
                )
                    context.interpolating = false;
                return context;
            }
        }

        if (
            (term === interpolatedHeredocStart || term === uninterpolatedHeredocStart) &&
            heredocQueue.slice(-1)[0]?.newlinePos !== context.newlinePos
        ) {
            const heredocContext = heredocQueue.pop();
            if (heredocContext) {
                heredocContext.parent = context;
                heredocContext.inBody = true;
                return heredocContext;
            }
        }

        if (
            context.parent &&
            ((context.type === 'quote' && input.next === context.endDelimiter) ||
                (context.type === 'quoteLike' && term === QuoteLikeEndDelimiter) ||
                (context.type === 'regex' && term === regexEnd) ||
                (context.type === 'quoteLike&regex' && term === regexEnd) ||
                (context.type === 'heredoc' && term === HeredocEndIdentifier) ||
                (context.type === 'iooperator' && term === IOOperatorEnd) ||
                (context.type === 'pg' && term === EndPG))
        ) {
            return context.parent;
        }

        return context;
    },
    strict: false
});

export const semicolon = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(automaticSemicolon) && input.next != 59 /* ; */ && (input.next < 0 || input.next == 125) /* } */)
        input.acceptToken(automaticSemicolon);
});

export const unrestrictedIdentifier = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(UnrestrictedIdentifier)) {
        gobbleWhitespace(input);
        if (input.next < 0 || isASCIILetter(input.next) || input.next == 95 /* _ */) return;
        while (input.next >= 0 && isIdentifierChar(input.next)) input.advance();
        input.acceptToken(UnrestrictedIdentifier);
    }
});

// Note that is only to pick up special variables that won't be considered as a ScalarVariable already.
export const specialScalarVariable = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(SpecialScalarVariable) && input.next == 36 /* $ */) {
        if (stack.canShift(Prototype)) return;
        const first = input.peek(1);
        const second = input.peek(2);
        if (first == 123 /* { */ && isSpecialVariableChar(second) && input.peek(3) == 125 /* } */) {
            input.acceptToken(SpecialScalarVariable, 4);
            return;
        }
        if (first == 123 /* { */ && second == 94 /* ^ */) {
            let pos = 3,
                ch;
            while ((isUpperCaseASCIILetter((ch = input.peek(pos))) || ch == 95) /* _ */ && ch != 125 /* } */) ++pos;
            if (ch == 125) {
                input.acceptToken(SpecialScalarVariable, pos + 1);
                return;
            }
        }
        if (first == 94 /* ^ */ && (isUpperCaseASCIILetter(second) || second == 95) /* _ */) {
            input.acceptToken(SpecialScalarVariable, 3);
            return;
        }
        if (!isSpecialVariableChar(first)) return;
        if (first == 36 /* $ */ && isIdentifierChar(second)) return;
        input.acceptToken(SpecialScalarVariable, 2);
        return;
    }
});

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
            if (input.next == 45 /* - */ && isFileTestOperatorChar(input.peek(1)) && !isASCIILetter(input.peek(2)))
                input.acceptToken(FileTestOp, 2);
        }

        // Start an IO operator if the following input contains a '<' character that is not followed by another
        // one or the following input specifically contains <<>>.
        if (
            stack.canShift(IOOperatorStart) &&
            input.next == 60 &&
            (input.peek(1) != 60 || (input.peek(2) == 62 && input.peek(3) == 62))
        ) {
            input.acceptToken(IOOperatorStart, 1);
            return;
        }

        if (!(stack.context instanceof Context) || stack.context.type !== 'iooperator') return;

        // End the IO operator when the '>' character is encountered.
        if (stack.canShift(IOOperatorEnd) && input.next == 62) {
            input.acceptToken(IOOperatorEnd, 1);
            return;
        }

        // In this case the initial '<' started the IO operator, and what follows is '<>>'
        // to finish the read only standard input declaration.
        if (input.peek(0) == 60 && input.peek(1) == 62 && input.peek(2) == 62) {
            input.acceptToken(ReadonlySTDIN, 2);
            return;
        }

        let pos = 0,
            ch: number;
        const isPossibleVariable = input.next == 36; /* $ */
        if (isPossibleVariable) ++pos;
        let haveWhitespace = false,
            haveNonASCII = false;
        while ((ch = input.peek(pos)) >= 0 && ch != 62 /* > */) {
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
            const indented = input.next == 126 && input.peek(1) != 126; /* ~ follows but not ~~ */
            if (indented) input.advance();
            gobbleWhitespace(input);
            const quote =
                input.next == 39 /* ' */ || input.next == 34 /* " */ || input.next == 96 /* ` */
                    ? input.next
                    : undefined;
            if (!quote && isWhitespace(input.peek(-1))) return;
            if (quote) input.advance();
            const escapedTag = !quote && input.next == 126 && input.peek(1) == 126; /* ~ */
            if (escapedTag && (isWhitespace(input.peek(-1)) || isWhitespace(input.peek(2)))) return;
            if (escapedTag) input.advance(2);
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

        if (stack.canShift(LaTeXImageCodeStart)) {
            if (input.peek(-2) != 45 /* - */ || input.peek(-1) != 62 /* > */) return;
            while (isHWhitespace(input.next)) input.advance();
            const isLatexImage = beginPGPrefix.concat(latexImage).every((l, index) => l == input.peek(index));
            if (isLatexImage || beginPGPrefix.concat(tikz).every((l, index) => l == input.peek(index))) {
                const tokenLength = beginPGPrefix.length + (isLatexImage ? latexImage.length : tikz.length);
                // Verify that only horizontal whitespace and semicolons are on the remainder of the line.
                let pos = tokenLength;
                let ch = input.peek(pos);
                while (ch >= 0 && (isHWhitespace(ch) || ch == 59) /* ; */) ch = input.peek(++pos);
                if (ch <= 0 || ch == 10 /* \n */) input.acceptToken(LaTeXImageCodeStart, tokenLength);
            }
        }

        if (!(stack.context instanceof Context)) return;

        if (
            input.next == 10 /* \n */ &&
            heredocQueue.length &&
            heredocQueue.slice(-1)[0]?.newlinePos !== stack.context.newlinePos &&
            (stack.canShift(uninterpolatedHeredocStart) || stack.canShift(interpolatedHeredocStart))
        ) {
            if (heredocQueue.slice(-1)[0]?.interpolating) input.acceptToken(interpolatedHeredocStart, 1);
            else input.acceptToken(uninterpolatedHeredocStart, 1);
            return;
        }

        if (stack.context.type !== 'heredoc' || !stack.context.inBody) return;

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
                if (input.next != 10 /* \n */) {
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
    },
    { contextual: true }
);

const scanEscape = (input: InputStream) => {
    const after = input.peek(2);

    // Restricted range octal character
    if (after >= 48 && after <= 55 /* 0-7 */) {
        let size = 3,
            next;
        while (size < 6 && (next = input.peek(size)) >= 48 && next <= 55) ++size;
        return size;
    }

    // Restricted range hexidecimal character
    if (after == 120 /* x */ && isHex(input.peek(3))) return isHex(input.peek(4)) ? 5 : 4;

    // Hexidecimal character
    if (after == 120 /* x */ && input.peek(3) == 123 /* { */) {
        // FIXME: There could be optional blanks at the beginning and end inside the braces.
        for (let size = 4; ; ++size) {
            const next = input.peek(size);
            if (next == 125 /* } */) return size + 1;
            if (!isHex(next)) break;
        }
    }

    // This could be any named unicode character or character sequence.
    if (after == 78 /* N */ && input.peek(3) == 123 /* { */) {
        for (let size = 4; ; ++size) {
            const next = input.peek(size);
            if (next == 125 /* } */) return size + 1;
            if (next < 0) break;
        }
    }

    // Octal character
    if (after == 111 /* o */ && input.peek(3) == 123 /* { */) {
        for (let size = 4; ; ++size) {
            const next = input.peek(size);
            if (next == 125 /* } */) return size + 1;
            if (next < 48 || next > 55 /* not 0-7 */) break;
        }
    }

    return 3;
};

export const interpolated = new ExternalTokenizer(
    (input, stack) => {
        if (!(stack.context instanceof Context) || !stack.context.interpolating) return;

        let content = false;
        for (; ; content = true) {
            if (
                heredocQueue.length &&
                (stack.context.type !== 'heredoc' ||
                    heredocQueue.slice(-1)[0]?.newlinePos !== stack.context.newlinePos) &&
                input.next == 10 /* \n */
            ) {
                break;
            }

            if (
                (stack.context.nestLevel == 0 && stack.context.atEnd(input)) ||
                input.next < 0 ||
                ((input.next == 36 /* $ */ || input.next == 64) /* @ */ &&
                    (isVariableStartChar(input.peek(1)) ||
                        input.peek(1) == 123 /* { */ ||
                        (isSpecialVariableChar(input.peek(1)) &&
                            (stack.context.nestLevel > 0 || input.peek(1) !== stack.context.endDelimiter))))
            ) {
                break;
            }

            if (
                stack.context.type.startsWith('quoteLike') &&
                stack.context.startDelimiter !== stack.context.endDelimiter &&
                input.next === stack.context.startDelimiter
            ) {
                ++stack.context.nestLevel;
            } else if (stack.context.nestLevel > 0 && input.next === stack.context.endDelimiter) {
                --stack.context.nestLevel;
            } else if (input.next == 126 /* ~ */ && input.peek(1) == 126) {
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
                (input.next == 91 /* [ */ ||
                    input.next == 123 /* { */ ||
                    (input.next == 45 /* - */ &&
                        input.peek(1) == 62 /* > */ &&
                        (input.peek(2) == 91 /* [ */ || input.peek(2) == 123))) /* { */ &&
                stack.canShift(afterInterpolation)
            ) {
                input.acceptToken(afterInterpolation);
                return;
            } else if (
                !content &&
                input.next == 58 /* : */ &&
                input.peek(1) == 58 &&
                (stack.canShift(packageNamePart) || stack.canShift(afterPackageName))
            ) {
                let pos = 2,
                    ch;
                while (isIdentifierChar((ch = input.peek(pos)))) ++pos;
                if (ch == 58 && input.peek(pos + 1) == 58) input.acceptToken(packageNamePart);
                else input.acceptToken(afterPackageName);
                return;
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
                        (input.next === stack.context.endDelimiter && input.peek(-2) == 126 && input.peek(-1) == 126))
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
                        (input.next === stack.context.endDelimiter && input.peek(-1) == 126 && input.peek(-1) == 126))
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
            if (input.next == 47 /* / */) input.acceptToken(patternMatchStart);
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

export const pod = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(PodDirective)) {
        if (
            (input.peek(-1) == 10 /* \n */ || input.peek(-1) < 0) &&
            input.next == 61 /* = */ &&
            isASCIILetter(input.peek(1))
        ) {
            while ((input.next as number) >= 0 && (input.next as number) != 10) input.advance();
            input.acceptToken(PodDirective);
            return;
        }
    }

    if (stack.canShift(PodContent)) {
        while (input.next >= 0) {
            if (input.next != 10) {
                input.advance();
                continue;
            }
            input.advance();
            if (
                input.peek(0) == 61 /* = */ &&
                input.peek(1) == 99 /* c */ &&
                input.peek(2) == 117 /* u */ &&
                input.peek(3) == 116 /* t */ &&
                (input.peek(4) == 10 || input.peek(4) < 0)
            )
                break;
        }
        input.acceptToken(PodContent);
        return;
    }

    if (stack.canShift(PodCut)) {
        if (
            (input.peek(-1) == 10 || input.peek(-1) < 0) &&
            input.peek(0) == 61 /* = */ &&
            input.peek(1) == 99 /* c */ &&
            input.peek(2) == 117 /* u */ &&
            input.peek(3) == 116 /* t */ &&
            (input.peek(4) == 10 || input.peek(4) < 0)
        ) {
            input.acceptToken(PodCut, 4);
            return;
        }
    }
});

export const endData = new ExternalTokenizer((input, stack) => {
    if (stack.canShift(endDataBlock)) {
        while (input.advance() >= 0);
        input.acceptToken(endDataBlock);
    }
});

export const pgText = new ExternalTokenizer(
    (input, stack) => {
        if (stack.canShift(BeginPG)) {
            let ch = input.peek(-1);
            if (ch >= 0 && ch != 10) return;
            let pos = 0;
            ch = input.next;
            while (isHWhitespace(ch)) ch = input.peek(++pos);

            if (!beginPGPrefix.every((l, index) => l == input.peek(pos + index))) return;
            pos += beginPGPrefix.length;

            const pgVariant = pgVariants.findIndex((variant) =>
                variant.every((l, index) => l == input.peek(pos + index))
            );
            if (pgVariant === -1) return;
            pos += pgVariants[pgVariant].length;
            ch = input.peek(pos);

            while (isHWhitespace(ch) || ch == 59 /* ; */) ch = input.peek(++pos);
            if (ch == 10 || ch < 0) input.acceptToken(BeginPG, pos);
        }

        if (!(stack.context instanceof Context) || stack.context.type !== 'pg' || !stack.context.tag) return;

        if (stack.canShift(PGMLContent) || stack.canShift(PGTextContent)) {
            if (input.peek(-1) != 10) return;
            while (input.next >= 0) {
                if (input.next != 10) {
                    input.advance();
                    continue;
                }
                input.advance();
                if (stack.context.atEnd(input)) break;
            }
            if (stack.context.tag[4] == 80) input.acceptToken(PGMLContent);
            else input.acceptToken(PGTextContent);
        } else if (stack.canShift(EndPG)) {
            const endPos = stack.context.atEnd(input);
            if (endPos) input.acceptToken(EndPG, endPos);
        }
    },
    { contextual: true }
);
