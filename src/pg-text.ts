import type { Input, NodePropSource, PartialParse, TreeFragment, Tree } from '@lezer/common';
import { NodeProp, NodeSet, NodeType, Parser } from '@lezer/common';
import { styleTags, tags as t } from '@lezer/highlight';
import { CompositeBlock, Element, TreeElement, elt } from './parse-elements';
import { skipSpace, isIdentifierChar, isVariableStartChar } from './text-utils';
import { pgPerlParser } from './pg-parser';

enum Type {
    PGTextContent = 1,

    DisplayMathMode,
    Emphasis,
    EmphasisMark,
    InlineMathMode,
    MathModeMark,
    ParsedMathMode,
    ParsedMathModeMark,
    PerlCommand,
    PerlCommandMark,
    StrongEmphasis,
    PerlInterpolation,

    PGTextError
}

const nodeProps = new Map<Type, [NodeProp<readonly string[]>, string[]][]>([
    [Type.PGTextContent, [[NodeProp.group, ['Block', 'BlockContext']]]]
]);

const nodeTypes = [NodeType.none];
for (let i = 1, name; (name = Type[i]); ++i) {
    nodeTypes[i] = NodeType.define({
        id: i,
        name,
        props: nodeProps.get(i) ?? [],
        top: name === 'PGTextContent',
        error: name === 'PGTextError'
    });
}

// Block-level parsing functions get access to this context object.
class BlockContext implements PartialParse {
    block: CompositeBlock;
    line = '';
    private to: number;
    stoppedAt: number | null = null;

    // The start and end of the current line.
    lineStart: number;
    lineEnd: number;

    // The range index that lineStart points into
    rangeI = 0;

    constructor(
        readonly parser: PGTextParser,
        readonly input: Input,
        _fragments: readonly TreeFragment[],
        readonly ranges: readonly { from: number; to: number }[]
    ) {
        this.to = ranges[ranges.length - 1].to;
        this.lineStart = this.lineEnd = ranges[0].from;
        this.block = CompositeBlock.create(Type.PGTextContent, this.lineStart, 0, 0);
        if (this.input.read(ranges[0].from, ranges[0].from + 1) == '\n') this.readLine();
    }

    get parsedPos() {
        return this.lineStart;
    }

    advance() {
        if ((this.stoppedAt != null && this.lineStart > this.stoppedAt) || !this.nextLine()) return this.finish();

        const cx = new InlineContext(this, this.line, this.lineStart);
        outer: for (let pos = this.lineStart; pos < cx.end; ) {
            const next = cx.char(pos);
            for (const token of InlineParsers) {
                const result = token(cx, next, pos);
                if (result >= 0) {
                    pos = result;
                    if (!cx.delimitersResolved() && pos >= cx.end) cx.nextLine();
                    continue outer;
                }
            }
            ++pos;
            if (!cx.delimitersResolved() && pos >= cx.end) cx.nextLine();
        }
        for (const elt of cx.takeContent(0, true)) {
            this.addNode(elt.toTree(this.parser.nodeSet), elt.from);
        }

        return null;
    }

    stopAt(pos: number) {
        if (this.stoppedAt != null && this.stoppedAt < pos) throw new RangeError("Can't move stoppedAt forward");
        this.stoppedAt = pos;
    }

    // Move to the next input line.
    nextLine() {
        if (this.lineEnd >= this.to) {
            this.lineStart = this.lineEnd;
            return false;
        } else {
            this.lineStart = this.lineEnd + 1;
            this.moveRangeI();
            this.readLine();
            return true;
        }
    }

    private moveRangeI() {
        while (this.rangeI < this.ranges.length - 1 && this.lineStart >= this.ranges[this.rangeI].to) {
            ++this.rangeI;
            this.lineStart = Math.max(this.lineStart, this.ranges[this.rangeI].from);
        }
    }

    readLine() {
        let text = '';
        let end = this.lineStart;
        if (this.lineStart < this.to) {
            text = this.lineChunkAt(this.lineStart);
            end += text.length;
            if (this.ranges.length > 1) {
                let textOffset = this.lineStart,
                    rangeI = this.rangeI;
                while (this.ranges[rangeI].to < end) {
                    ++rangeI;
                    const nextFrom = this.ranges[rangeI].from;
                    const after = this.lineChunkAt(nextFrom);
                    end = nextFrom + after.length;
                    text = text.slice(0, this.ranges[rangeI - 1].to - textOffset) + after;
                    textOffset = end - text.length;
                }
            }
        }
        this.lineEnd = end;
        this.line = text;
    }

    private lineChunkAt(pos: number) {
        let text = this.input.chunk(pos);
        if (!this.input.lineChunks) {
            const eol = text.indexOf('\n');
            text = eol < 0 ? text : text.slice(0, eol);
        } else if (text === '\n') {
            text = '';
        }
        return pos + text.length > this.to ? text.slice(0, this.to - pos) : text;
    }

    addNode(block: Tree, from: number) {
        this.block.addChild(block, from - this.block.from);
    }

    private finish() {
        return this.block.toTree(this.parser.nodeSet, this.lineStart);
    }
}

interface DelimiterType {
    nodeType?: Type;
    mark?: Type;
}

const Delimiters: Record<string, DelimiterType> = {
    InlineMathMode: { nodeType: Type.InlineMathMode, mark: Type.MathModeMark },
    DisplayMathMode: { nodeType: Type.DisplayMathMode, mark: Type.MathModeMark },
    ParsedMathMode: { nodeType: Type.ParsedMathMode, mark: Type.ParsedMathModeMark },
    Emphasis: { nodeType: Type.Emphasis, mark: Type.EmphasisMark },
    StrongEmphasis: { nodeType: Type.StrongEmphasis, mark: Type.EmphasisMark },
    PerlInterpolation: { nodeType: Type.PerlInterpolation },
    // These are only allowed to occur in a perl interpolation and do not resolve to actual elements.
    Brace: {},
    Bracket: {}
};

class InlineDelimiter {
    constructor(
        readonly type: DelimiterType,
        readonly from: number,
        public to: number,
        public forceResolve = true,
        public interpolationParent?: InlineDelimiter
    ) {}
}

const bold = [66, 79, 76, 68]; // BOLD
const italic = [73, 84, 65, 76, 73, 67]; // ITALIC

const InlineParsers: ((cx: InlineContext, next: number, pos: number) => number)[] = [
    // Perl command
    (cx, next, start) => {
        if (next != 92 /* \\ */ || cx.char(start + 1) != 123 /* { */) return -1;
        let pos = start + 2;
        for (; !cx.atEnd(pos) && (cx.char(pos) != 92 /* \ */ || cx.char(pos + 1) != 125) /* } */; ++pos);
        const end = pos + 2 < cx.end ? pos + 2 : cx.end;
        return cx.append(
            elt(Type.PerlCommand, start, end, [
                elt(Type.PerlCommandMark, start, start + 2),
                new TreeElement(pgPerlParser.parse(cx.slice(start + 2, pos)), start + 2),
                cx.char(end - 2) == 92 && cx.char(end - 1) == 125
                    ? elt(Type.PerlCommandMark, pos, end)
                    : elt(Type.PGTextError, end, end)
            ])
        );
    },

    // Emphasis
    (cx, next, start) => {
        if (next != 36 /* $ */) return -1;

        let pos = start + 1;
        const haveBrace = cx.char(pos) == 123; /* { */
        if (haveBrace) {
            ++pos;
            pos = cx.skipSpace(pos);
        }

        // BBOLD
        const isBold = [66, ...bold].every((ch, i) => cx.char(pos + i) == ch);
        // BITALIC
        const isItalic = [66, ...italic].every((ch, i) => cx.char(pos + i) == ch);

        if (isBold) pos += 5;
        else if (isItalic) pos += 7;
        else return -1;

        if (haveBrace) {
            pos = cx.skipSpace(pos);
            if (cx.char(pos) != 125 /* } */) return -1;
            ++pos;
        } else if (isIdentifierChar(cx.char(pos))) return -1;

        return cx.addDelimiter(isBold ? Delimiters.StrongEmphasis : Delimiters.Emphasis, start, pos);
    },

    // Emphasis end
    (cx, next, start) => {
        if (next != 36 /* $ */) return -1;

        let pos = start + 1;
        const haveBrace = cx.char(pos) == 123; /* { */
        if (haveBrace) {
            ++pos;
            pos = cx.skipSpace(pos);
        }

        // EBOLD
        const isBold = [69, ...bold].every((ch, i) => cx.char(pos + i) == ch);
        // EITALIC
        const isItalic = [69, ...italic].every((ch, i) => cx.char(pos + i) == ch);

        if (isBold) pos += 5;
        else if (isItalic) pos += 7;
        else return -1;

        if (haveBrace) {
            pos = cx.skipSpace(pos);
            if (cx.char(pos) != 125 /* } */) return -1;
            ++pos;
        } else if (isIdentifierChar(cx.char(pos))) return -1;

        // Scan back to the last emphasis start marker.
        for (let i = cx.parts.length - 1; i >= 0; --i) {
            const part = cx.parts[i];
            if (
                part instanceof InlineDelimiter &&
                (part.type === Delimiters.Emphasis || part.type === Delimiters.StrongEmphasis) &&
                part.type.nodeType
            ) {
                // Finish the content and replace the entire range in cx.parts with the emphasis node.
                const content = cx.takeContent(i);
                content.unshift(elt(Type.EmphasisMark, part.from, part.to));
                content.push(elt(Type.EmphasisMark, start, pos));
                const emphasis = (cx.parts[i] = elt(part.type.nodeType, part.from, pos, content));
                return emphasis.to;
            }
        }
        return -1;
    },

    // Perl Interpolation
    // FIXME: Quotes and heredocs are not supported in interpolation at this point.
    (cx, next, start) => {
        const haveBrace = cx.char(start + 1) == 123; /* { */
        if (next != 36 /* $ */ || (!isVariableStartChar(cx.char(start + 1)) && !haveBrace)) return -1;
        if (haveBrace) {
            cx.addDelimiter(Delimiters.PerlInterpolation, start, start + 2, false);
            return cx.addDelimiter(Delimiters.Brace, start + 1, start + 2, true, cx.parts.at(-1) as InlineDelimiter);
        }
        let pos = start + 2;
        for (; pos < cx.end && isIdentifierChar(cx.char(pos)); ++pos);
        return cx.addDelimiter(Delimiters.PerlInterpolation, start, pos, false);
    },

    // Brace or bracket
    (cx, next, start) => {
        if (next != 123 /* { */ && next != 91 /* [ */) return -1;
        // Scan back and see if there is an open interpolation that ends here.
        // If not, then ignore the brace or bracket.
        for (let i = cx.parts.length - 1; i >= 0; --i) {
            const part = cx.parts[i];
            if (
                part instanceof InlineDelimiter &&
                part.type === Delimiters.PerlInterpolation &&
                part.to == start &&
                cx.char(part.from + 1) != 123
            ) {
                ++part.to;
                return cx.addDelimiter(
                    next == 123 ? Delimiters.Brace : Delimiters.Bracket,
                    start,
                    start + 1,
                    true,
                    part
                );
            }
        }
        return -1;
    },

    // Brace or bracket end (only in perl interpolation)
    (cx, next, start) => {
        if (next != 125 /* } */ && next != 93 /* ] */) return -1;
        // Scan back to the matching start marker.
        for (let i = cx.parts.length - 1; i >= 0; --i) {
            const part = cx.parts[i];
            if (
                part instanceof InlineDelimiter &&
                ((next == 125 && part.type === Delimiters.Brace) || (next == 93 && part.type === Delimiters.Bracket)) &&
                part.interpolationParent
            ) {
                part.interpolationParent.to = start + 1;
                cx.parts.splice(i, 1);
                return start + 1;
            }
        }
        return -1;
    },

    // Dereferencing arrow (only in perl interpolation)
    (cx, next, start) => {
        if (
            next != 45 /* - */ ||
            cx.char(start + 1) != 62 /* > */ ||
            (cx.char(start + 2) != 123 /* { */ && cx.char(start + 2) != 91) /* [ */
        )
            return -1;
        // Scan back and see if there is an open interpolation that ends here.
        // If not, then ignore the dereferencing arrow.
        for (let i = cx.parts.length - 1; i >= 0; --i) {
            const part = cx.parts[i];
            if (
                part instanceof InlineDelimiter &&
                part.type === Delimiters.PerlInterpolation &&
                part.to == start &&
                cx.char(part.from + 1) != 123
            ) {
                part.to += 2;
                return start + 2;
            }
        }
        return -1;
    },

    // Math mode
    (cx, next, start) => {
        if (next != 92 /* \\ */ || (cx.char(start + 1) != 40 /* ( */ && cx.char(start + 1) != 91) /* [ */) return -1;
        return cx.addDelimiter(
            cx.char(start + 1) == 40 ? Delimiters.InlineMathMode : Delimiters.DisplayMathMode,
            start,
            start + 2
        );
    },

    // Math mode end
    (cx, next, start) => {
        if (next != 92 /* \\ */ || (cx.char(start + 1) != 41 /* ) */ && cx.char(start + 1) != 93) /* ] */) return -1;
        // Scan back to the last math mode start marker.
        for (let i = cx.parts.length - 1; i >= 0; --i) {
            const part = cx.parts[i];
            if (
                part instanceof InlineDelimiter &&
                (part.type === Delimiters.InlineMathMode || part.type === Delimiters.DisplayMathMode) &&
                part.type.nodeType
            ) {
                const content = cx.takeContent(i);

                // If there is an in progress math mode, then replace the entire range with an error node.
                if (
                    cx.parts.find(
                        (p) =>
                            p instanceof InlineDelimiter &&
                            (p.type === Delimiters.InlineMathMode || p.type === Delimiters.DisplayMathMode)
                    )
                ) {
                    const errorNode = (cx.parts[i] = elt(Type.PGTextError, part.from, start + 2));
                    return errorNode.to;
                }

                // Finish the content and replace the entire range in cx.parts with the math mode node.
                content.unshift(elt(Type.MathModeMark, part.from, part.to));
                content.push(elt(Type.MathModeMark, start, start + 2));
                const mathMode = (cx.parts[i] = elt(part.type.nodeType, part.from, start + 2, content));
                return mathMode.to;
            }
        }
        return -1;
    },

    // Parsed math mode
    (cx, next, start) => {
        if (
            next != 96 /* ` */ ||
            (start &&
                cx.char(start - 1) == 96 &&
                (!(cx.parts.at(-1) instanceof Element) || cx.parts.at(-1)?.type !== Type.ParsedMathMode)) ||
            cx.parts.find((p) => p instanceof InlineDelimiter && p.type === Delimiters.ParsedMathMode)
        )
            return -1;
        return cx.addDelimiter(Delimiters.ParsedMathMode, start, start + (cx.char(start + 1) == 96 ? 1 : 0) + 1);
    },

    // Parsed math mode end
    (cx, next, start) => {
        if (next != 96 /* ` */ || (start && cx.char(start - 1) == 96)) return -1;
        // Scan back to the last parsed math mode start marker.
        for (let i = cx.parts.length - 1; i >= 0; --i) {
            const part = cx.parts[i];
            if (part instanceof InlineDelimiter && part.type === Delimiters.ParsedMathMode && part.type.nodeType) {
                const content = cx.takeContent(i);

                const numBackticks = part.to - part.from;
                if (numBackticks == 2 && cx.char(start + 1) != 96) return -1;

                // Finish the content and replace the entire range in cx.parts with the parsed math mode node.
                const star = cx.char(start + numBackticks) == 42 /* * */ ? 1 : 0;
                content.unshift(elt(Type.ParsedMathModeMark, part.from, part.to));
                content.push(elt(Type.ParsedMathModeMark, start, start + numBackticks + star));
                const mathMode = (cx.parts[i] = elt(
                    part.type.nodeType,
                    part.from,
                    start + numBackticks + star,
                    content
                ));
                return mathMode.to;
            }
        }
        return -1;
    }
];

// Inline parsing functions get access to this context, and use it to read the content and emit syntax nodes.
class InlineContext {
    parts: (Element<Type> | InlineDelimiter | null)[] = [];

    constructor(
        // The current block context.
        readonly blockContext: BlockContext,
        // The text of this inline section.
        public text: string,
        // The starting offset of the section in the document.
        readonly offset: number
    ) {}

    // Get the character code at the given (document-relative) position.
    char(pos: number) {
        return pos >= this.end ? -1 : this.text.charCodeAt(pos - this.offset);
    }

    // The position of the end of this inline section.
    get end() {
        return this.offset + this.text.length;
    }

    atEnd(pos: number) {
        return pos >= this.end && !this.nextLine();
    }

    nextLine() {
        const nextLineExists = this.blockContext.nextLine();
        if (nextLineExists) this.text += '\n' + this.blockContext.line;
        return nextLineExists;
    }

    // Get a substring of this inline section. Again uses document-relative positions.
    slice(from: number, to: number) {
        return this.text.slice(from - this.offset, to - this.offset);
    }

    append(elt: Element<Type> | InlineDelimiter) {
        this.parts.push(elt);
        return elt.to;
    }

    // Add a delimiter at this given position. `open` and `close` indicate whether this delimiter is opening, closing,
    // or both. Returns the end of the delimiter, for convenient returning from parse functions.
    addDelimiter(type: DelimiterType, from: number, to: number, forceResolve = true, parent?: InlineDelimiter) {
        return this.append(new InlineDelimiter(type, from, to, forceResolve, parent));
    }

    delimitersResolved() {
        for (const part of this.parts) {
            if (part instanceof InlineDelimiter && part.forceResolve) return false;
        }
        return true;
    }

    // Return element parts from the given start index on as an array of elements.  All unresolved inline delimiters in
    // the range (except a delimiter in the startIndex position if resolveStart is true) are turned into the appropriate
    // node terminated by an error node.
    takeContent(startIndex = 0, resolveStart = false) {
        const content = [];
        for (let i = startIndex; i < this.parts.length; ++i) {
            const part = this.parts[i];
            if (part instanceof Element) content.push(part);
            else if ((resolveStart || i > startIndex) && part instanceof InlineDelimiter) {
                if (part.type.mark && part.type.nodeType) {
                    const to = this.parts[i + 1]?.from ?? this.end;
                    content.push(
                        elt(part.type.nodeType, part.from, to, [
                            elt(part.type.mark, part.from, part.to),
                            elt(Type.PGTextError, to, to)
                        ])
                    );
                } else if (part.type === Delimiters.PerlInterpolation) {
                    content.push(
                        elt(Type.PerlInterpolation, part.from, part.to, [
                            new TreeElement(pgPerlParser.parse(this.slice(part.from, part.to)), part.from)
                        ])
                    );
                }
            }
        }
        this.parts.length = startIndex;
        return content;
    }

    // Skip space after the given (document) position, returning either the position of the next non-space character or
    // the end of the section.
    skipSpace(from: number) {
        return skipSpace(this.text, from - this.offset) + this.offset;
    }
}

export const pgTextHighlighting = styleTags({
    'MathModeMark ParsedMathModeMark PerlCommandMark': t.processingInstruction,
    'InlineMathMode DisplayMathMode ParsedMathMode': t.atom,
    EmphasisMark: t.special(t.variableName),
    'Emphasis/...': t.emphasis,
    'StrongEmphasis/...': t.strong,
    PGTextError: t.invalid
});

// A PG Text parser configuration.
export class PGTextParser extends Parser {
    nodeTypes = Object.create(null) as Record<string, number>;
    readonly nodeSet: NodeSet;

    // The parser's syntax [node types](https://lezer.codemirror.net/docs/ref/#common.NodeSet).
    constructor(props?: NodePropSource[]) {
        super();
        this.nodeSet = new NodeSet(nodeTypes).extend(pgTextHighlighting, ...(props?.length ? props : []));
        for (const t of this.nodeSet.types) this.nodeTypes[t.name] = t.id;
    }

    createParse(
        input: Input,
        fragments: readonly TreeFragment[],
        ranges: readonly { from: number; to: number }[]
    ): PartialParse {
        return new BlockContext(this, input, fragments, ranges);
    }

    getNodeType(name: string) {
        return this.nodeTypes[name];
    }
}
