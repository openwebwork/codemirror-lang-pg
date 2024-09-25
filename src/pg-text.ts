import type { Input, PartialParse, TreeBuffer, TreeCursor, TreeFragment } from '@lezer/common';
import { NodeProp, NodeSet, NodeType, Parser, Tree } from '@lezer/common';
import { styleTags, tags as t } from '@lezer/highlight';
import { parser as pgPerlParser } from './pg.grammar';
import { skipSpace, isIdentifierChar, isVariableStartChar } from './text-utils';

class CompositeBlock {
    static create(type: number, from: number, parentHash: number, end: number) {
        const hash = (parentHash + (parentHash << 8) + type) | 0;
        return new CompositeBlock(type, from, hash, end, [], []);
    }

    hashProp: [NodeProp<unknown>, unknown][];

    constructor(
        readonly type: number,
        readonly from: number,
        readonly hash: number,
        public end: number,
        readonly children: (Tree | TreeBuffer)[],
        readonly positions: number[]
    ) {
        this.hashProp = [[NodeProp.contextHash, hash]];
    }

    addChild(child: Tree, pos: number) {
        if (child.prop(NodeProp.contextHash) != this.hash)
            child = new Tree(child.type, child.children, child.positions, child.length, this.hashProp);
        this.children.push(child);
        this.positions.push(pos);
    }

    toTree(nodeSet: NodeSet, end = this.end) {
        const last = this.children.length - 1;
        if (last >= 0) end = Math.max(end, this.positions[last] + this.children[last].length + this.from);
        return new Tree(nodeSet.types[this.type], this.children, this.positions, end - this.from).balance({
            makeTree: (children, positions, length) =>
                new Tree(NodeType.none, children, positions, length, this.hashProp)
        });
    }
}

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
    Variable,

    PGTextError
}

// Block-level parsing functions get access to this context object.
class BlockContext implements PartialParse {
    block: CompositeBlock;
    line = '';
    private atEnd = false;
    private fragments: FragmentCursor | null;
    private to: number;
    // For reused nodes on gaps, we can't directly put the original node into the tree, since that may be better than
    // its parent.  When this happens, we create a dummy tree that is replaced by the proper node in `injectGaps`
    reusePlaceholders = new Map<Tree, Tree>();
    stoppedAt: number | null = null;

    // The start of the current line.
    lineStart: number;
    // The absolute (non-gap-adjusted) position of the line
    absoluteLineStart: number;
    // The range index that absoluteLineStart points into
    rangeI = 0;
    absoluteLineEnd: number;

    constructor(
        // The parser configuration used.
        readonly parser: PGTextParser,
        readonly input: Input,
        fragments: readonly TreeFragment[],
        readonly ranges: readonly { from: number; to: number }[]
    ) {
        this.to = ranges[ranges.length - 1].to;
        this.lineStart = this.absoluteLineStart = this.absoluteLineEnd = ranges[0].from;
        this.block = CompositeBlock.create(Type.PGTextContent, this.lineStart, 0, 0);
        this.fragments = fragments.length ? new FragmentCursor(fragments, input) : null;
        this.readLine();
    }

    get parsedPos() {
        return this.absoluteLineStart;
    }

    advance() {
        if ((this.stoppedAt != null && this.absoluteLineStart > this.stoppedAt) || !this.nextLine())
            return this.finish();
        if (this.fragments && this.reuseFragment(0)) return null;

        const start = this.lineStart;
        const content = this.line;

        const cx = new InlineContext(this, content, start);
        outer: for (let pos = start; pos < cx.end; ) {
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
        for (const elt of cx.takeContent()) {
            this.addNode(elt.toTree(this.parser.nodeSet), elt.from);
        }

        return null;
    }

    stopAt(pos: number) {
        if (this.stoppedAt != null && this.stoppedAt < pos) throw new RangeError("Can't move stoppedAt forward");
        this.stoppedAt = pos;
    }

    private reuseFragment(start: number) {
        if (
            !this.fragments?.moveTo(this.absoluteLineStart + start, this.absoluteLineStart) ||
            !this.fragments.matches(this.block.hash)
        )
            return false;
        const taken = this.fragments.takeNodes(this);
        if (!taken) return false;
        this.absoluteLineStart += taken;
        this.lineStart = toRelative(this.absoluteLineStart, this.ranges);
        this.moveRangeI();
        if (this.absoluteLineStart < this.to) {
            ++this.lineStart;
            ++this.absoluteLineStart;
            this.readLine();
        } else {
            this.atEnd = true;
            this.readLine();
        }
        return true;
    }

    // Move to the next input line.
    nextLine() {
        this.lineStart += this.line.length;
        if (this.absoluteLineEnd >= this.to) {
            this.absoluteLineStart = this.absoluteLineEnd;
            this.atEnd = true;
            this.readLine();
            return false;
        } else {
            ++this.lineStart;
            this.absoluteLineStart = this.absoluteLineEnd + 1;
            this.moveRangeI();
            this.readLine();
            return true;
        }
    }

    private moveRangeI() {
        while (this.rangeI < this.ranges.length - 1 && this.absoluteLineStart >= this.ranges[this.rangeI].to) {
            ++this.rangeI;
            this.absoluteLineStart = Math.max(this.absoluteLineStart, this.ranges[this.rangeI].from);
        }
    }

    scanLine(start: number) {
        const r = { text: '', end: 0 };
        r.end = start;
        if (start >= this.to) {
            r.text = '';
        } else {
            r.text = this.lineChunkAt(start);
            r.end += r.text.length;
            if (this.ranges.length > 1) {
                let textOffset = this.absoluteLineStart,
                    rangeI = this.rangeI;
                while (this.ranges[rangeI].to < r.end) {
                    ++rangeI;
                    const nextFrom = this.ranges[rangeI].from;
                    const after = this.lineChunkAt(nextFrom);
                    r.end = nextFrom + after.length;
                    r.text = r.text.slice(0, this.ranges[rangeI - 1].to - textOffset) + after;
                    textOffset = r.end - r.text.length;
                }
            }
        }
        return r;
    }

    readLine() {
        const { text, end } = this.scanLine(this.absoluteLineStart);
        this.absoluteLineEnd = end;
        this.line = text;
    }

    private lineChunkAt(pos: number) {
        const next = this.input.chunk(pos);
        let text;
        if (!this.input.lineChunks) {
            const eol = next.indexOf('\n');
            text = eol < 0 ? next : next.slice(0, eol);
        } else {
            text = next == '\n' ? '' : next;
        }
        return pos + text.length > this.to ? text.slice(0, this.to - pos) : text;
    }

    // The end position of the previous line.
    prevLineEnd() {
        return this.atEnd ? this.lineStart : this.lineStart - 1;
    }

    addNode(block: Tree, from: number) {
        this.block.addChild(block, from - this.block.from);
    }

    private finish() {
        return this.block.toTree(this.parser.nodeSet, this.lineStart);
    }
}

// A PG Text parser configuration.
export class PGTextParser extends Parser {
    nodeTypes = Object.create(null) as Record<string, number>;

    // The parser's syntax node types.
    constructor(readonly nodeSet: NodeSet) {
        super();
        for (const t of nodeSet.types) this.nodeTypes[t.name] = t.id;
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

const nodeTypes = [NodeType.none];
for (let i = 1, name; (name = Type[i]); ++i) {
    nodeTypes[i] = NodeType.define({
        id: i,
        name,
        props: i > Type.PGTextContent.valueOf() ? [] : [[NodeProp.group, ['Block', 'BlockContext']]],
        top: name === 'PGTextContent',
        error: name === 'PGTextError'
    });
}

class Buffer {
    content: number[] = [];
    nodes: Tree[] = [];
    constructor(readonly nodeSet: NodeSet) {}

    write(type: Type, from: number, to: number, children = 0) {
        this.content.push(type, from, to, 4 + children * 4);
        return this;
    }

    writeElements(elts: readonly (Element | TreeElement)[], offset = 0) {
        for (const e of elts) e.writeTo(this, offset);
        return this;
    }

    finish(type: Type, length: number) {
        return Tree.build({
            buffer: this.content,
            nodeSet: this.nodeSet,
            reused: this.nodes,
            topID: type,
            length
        });
    }
}

// Elements are used to compose syntax nodes during parsing.
class Element {
    constructor(
        // The node's id.
        readonly type: number,
        // The start of the node, as an offset from the start of the document.
        readonly from: number,
        // The end of the node.
        public to: number,
        // The node's child nodes
        readonly children: readonly (Element | TreeElement)[] = []
    ) {}

    writeTo(buf: Buffer, offset: number) {
        const startOff = buf.content.length;
        buf.writeElements(this.children, offset);
        buf.content.push(this.type, this.from + offset, this.to + offset, buf.content.length + 4 - startOff);
    }

    toTree(nodeSet: NodeSet): Tree {
        return new Buffer(nodeSet).writeElements(this.children, -this.from).finish(this.type, this.to - this.from);
    }
}

class TreeElement {
    constructor(
        readonly tree: Tree,
        readonly from: number
    ) {}

    get to() {
        return this.from + this.tree.length;
    }

    get type() {
        return this.tree.type.id;
    }

    get children() {
        return [];
    }

    writeTo(buf: Buffer, offset: number) {
        buf.nodes.push(this.tree);
        buf.content.push(buf.nodes.length - 1, this.from + offset, this.to + offset, -1);
    }

    toTree(): Tree {
        return this.tree;
    }
}

const elt = (type: Type, from: number, to: number, children?: readonly (Element | TreeElement)[]) => {
    return new Element(type, from, to, children);
};

enum DelimiterType {
    InlineMathMode = 1,
    DisplayMathMode,
    PerlCommand,
    Emphasis,
    StrongEmphasis
}

class InlineDelimiter {
    constructor(
        readonly type: DelimiterType,
        readonly from: number,
        readonly to: number
    ) {}
}

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
                elt(Type.PerlCommandMark, pos, end)
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

        /* BBOLD */
        const isBold = [66, 66, 79, 76, 68].every((ch, i) => cx.char(pos + i) == ch);
        /* BITALIC */
        const isItalic = [66, 73, 84, 65, 76, 73, 67].every((ch, i) => cx.char(pos + i) == ch);

        if (isBold) pos += 5;
        else if (isItalic) pos += 7;
        else return -1;

        if (haveBrace) {
            pos = cx.skipSpace(pos);
            if (cx.char(pos) != 125 /* } */) return -1;
            ++pos;
        } else if (isIdentifierChar(cx.char(pos))) return -1;

        return cx.addDelimiter(isBold ? DelimiterType.StrongEmphasis : DelimiterType.Emphasis, start, pos);
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

        /* EBOLD */
        const isBold = [69, 66, 79, 76, 68].every((ch, i) => cx.char(pos + i) == ch);
        /* EITALIC */
        const isItalic = [69, 73, 84, 65, 76, 73, 67].every((ch, i) => cx.char(pos + i) == ch);

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
                (part.type === DelimiterType.Emphasis || part.type === DelimiterType.StrongEmphasis)
            ) {
                // Finish the content and replace the entire range in cx.parts with the emphasis node.
                const content = cx.takeContent(i);
                content.unshift(elt(Type.EmphasisMark, part.from, part.to));
                content.push(elt(Type.EmphasisMark, start, pos));
                const emphasis = (cx.parts[i] = elt(
                    isBold ? Type.StrongEmphasis : Type.Emphasis,
                    part.from,
                    pos,
                    content
                ));
                return emphasis.to;
            }
        }
        return -1;
    },

    // Variable
    // FIXME: This does not catch interpolation like $b[1] where @b is an array, or $b{a} where %b is a hash, or more
    // complicated constructs like nested array or hash access or ${~~(...)} (which does work in a BEGIN_TEXT block).
    // Those things are rarely done anyway, so this is not a high priority.  Furthermore, authors should be using PGML
    // anyway.
    (cx, next, start) => {
        const haveBrace = cx.char(start + 1) == 123;
        if (next != 36 /* $ */ || (!isVariableStartChar(cx.char(start + 1)) && !haveBrace) /* { */) return -1;
        let pos = start + 2;
        if (haveBrace) pos = cx.skipSpace(pos);
        for (; pos < cx.end && isIdentifierChar(cx.char(pos)); ++pos);
        if (haveBrace) {
            pos = cx.skipSpace(pos);
            if (cx.char(pos) != 125 /* } */) return cx.append(elt(Type.PGTextError, start, pos));
            if (cx.char(pos) == 125 /* } */) ++pos;
        }
        return cx.append(elt(Type.Variable, start, pos));
    },

    // Math mode
    (cx, next, start) => {
        if (next != 92 /* \\ */ || (cx.char(start + 1) != 40 /* ( */ && cx.char(start + 1) != 91) /* [ */) return -1;
        return cx.addDelimiter(
            cx.char(start + 1) == 40 ? DelimiterType.InlineMathMode : DelimiterType.DisplayMathMode,
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
                (part.type === DelimiterType.InlineMathMode || part.type === DelimiterType.DisplayMathMode)
            ) {
                const content = cx.takeContent(i);

                // If there is an in progress math mode, then replace the entire range with an error node.
                if (
                    cx.parts.find(
                        (p) =>
                            p instanceof InlineDelimiter &&
                            (p.type === DelimiterType.InlineMathMode || p.type === DelimiterType.DisplayMathMode)
                    )
                ) {
                    const errorNode = (cx.parts[i] = elt(Type.PGTextError, part.from, start + 2));
                    return errorNode.to;
                }

                // Finish the content and replace the entire range in cx.parts with the math mode node.
                content.unshift(elt(Type.MathModeMark, part.from, part.to));
                content.push(elt(Type.MathModeMark, start, start + 2));
                const mathMode = (cx.parts[i] = elt(
                    part.type == DelimiterType.InlineMathMode ? Type.InlineMathMode : Type.DisplayMathMode,
                    part.from,
                    start + 2,
                    content
                ));
                return mathMode.to;
            }
        }
        return -1;
    },

    // Parsed math mode
    (cx, next, start) => {
        if (next != 96 /* ` */ || (start && cx.char(start - 1) == 96)) return -1;
        let pos = start + 1;
        while (pos < cx.end && cx.char(pos) == 96) ++pos;
        const size = pos - start;
        if (size > 2) return cx.append(elt(Type.PGTextError, start, start + size));
        let curSize = 0;
        for (; !cx.atEnd(pos); ++pos) {
            if (cx.char(pos) == 96) {
                ++curSize;
                if (curSize == size && cx.char(pos + 1) != 96) {
                    const star = cx.char(pos + 1) == 42 /* * */ ? 1 : 0;
                    return cx.append(
                        elt(Type.ParsedMathMode, start, pos + 1 + star, [
                            elt(Type.ParsedMathModeMark, start, start + size),
                            elt(Type.ParsedMathModeMark, pos + 1 - size, pos + 1 + star)
                        ])
                    );
                } else if (curSize == size && cx.char(pos + 1) == 96) {
                    while (cx.char(++pos) == 96);
                    return cx.append(elt(Type.PGTextError, start, pos + 1));
                }
            } else if (curSize) {
                return cx.append(elt(Type.PGTextError, start, pos));
            }
        }
        return -1;
    }
];

// Inline parsing functions get access to this context, and use it to read the content and emit syntax nodes.
class InlineContext {
    parts: (Element | InlineDelimiter | null)[] = [];

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

    append(elt: Element | InlineDelimiter) {
        this.parts.push(elt);
        return elt.to;
    }

    // Add a delimiter at this given position. `open` and `close` indicate whether this delimiter is opening, closing,
    // or both. Returns the end of the delimiter, for convenient returning from parse functions.
    addDelimiter(type: DelimiterType, from: number, to: number) {
        return this.append(new InlineDelimiter(type, from, to));
    }

    delimitersResolved() {
        for (const part of this.parts) {
            if (part instanceof InlineDelimiter) return false;
        }
        return true;
    }

    // Return element parts from the given start index on as an array of elements.
    // All unresolved inline delimiters in the range are dropped.
    takeContent(startIndex = 0) {
        const content = [];
        for (let i = startIndex; i < this.parts.length; ++i) {
            const part = this.parts[i];
            if (part instanceof Element) content.push(part);
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

class FragmentCursor {
    // Index into fragment array
    i = 0;
    // Active fragment
    fragment: TreeFragment | null = null;
    fragmentEnd = -1;
    // Cursor into the current fragment, if any. When `moveTo` returns true, this points at the first block after `pos`.
    cursor: TreeCursor | null = null;

    constructor(
        readonly fragments: readonly TreeFragment[],
        readonly input: Input
    ) {
        if (fragments.length) this.fragment = fragments[this.i++];
    }

    nextFragment() {
        this.fragment = this.i < this.fragments.length ? this.fragments[this.i++] : null;
        this.cursor = null;
        this.fragmentEnd = -1;
    }

    moveTo(pos: number, lineStart: number) {
        while (this.fragment && this.fragment.to <= pos) this.nextFragment();
        if (!this.fragment || this.fragment.from > (pos ? pos - 1 : 0)) return false;
        if (this.fragmentEnd < 0) {
            let end = this.fragment.to;
            while (end > 0 && this.input.read(end - 1, end) != '\n') --end;
            this.fragmentEnd = end ? end - 1 : 0;
        }

        let c = this.cursor;
        if (!c) {
            c = this.cursor = this.fragment.tree.cursor();
            c.firstChild();
        }

        const rPos = pos + this.fragment.offset;
        while (c.to <= rPos) if (!c.parent()) return false;
        for (;;) {
            if (c.from >= rPos) return this.fragment.from <= lineStart;
            if (!c.childAfter(rPos)) return false;
        }
    }

    matches(hash: number) {
        const tree = this.cursor?.tree;
        return tree && tree.prop(NodeProp.contextHash) == hash;
    }

    takeNodes(cx: BlockContext) {
        const cur = this.cursor,
            off = this.fragment?.offset,
            fragEnd = this.fragmentEnd - (this.fragment?.openEnd ? 1 : 0);
        if (!cur || !off) return 0;
        const start = cx.absoluteLineStart;
        let end = start,
            blockI = cx.block.children.length;
        for (;;) {
            if (cur.to - off > fragEnd) {
                if (cur.type.isAnonymous && cur.firstChild()) continue;
                break;
            }
            const pos = toRelative(cur.from - off, cx.ranges);
            if (cur.to - off <= cx.ranges[cx.rangeI].to) {
                // Fits in current range
                if (cur.tree) cx.addNode(cur.tree, pos);
            } else {
                const dummy = new Tree(cx.parser.nodeSet.types[Type.PGTextContent], [], [], 0, cx.block.hashProp);
                if (cur.tree) cx.reusePlaceholders.set(dummy, cur.tree);
                cx.addNode(dummy, pos);
            }
            // Taken content must always end in a block, because incremental parsing happens on block boundaries. Never
            // stop directly after an indented code block, since those can continue after any number of blank lines.
            if (cur.type.is('Block')) {
                end = cur.to - off;
                blockI = cx.block.children.length;
            }
            if (!cur.nextSibling()) break;
        }
        while (cx.block.children.length > blockI) {
            cx.block.children.pop();
            cx.block.positions.pop();
        }
        return end - start;
    }
}

// Convert an input-stream-relative position to a pg document relative position by subtracting the size of all
// input gaps before `abs`.
const toRelative = (abs: number, ranges: readonly { from: number; to: number }[]) => {
    let pos = abs;
    for (let i = 1; i < ranges.length; ++i) {
        const gapFrom = ranges[i - 1].to,
            gapTo = ranges[i].from;
        if (gapFrom < abs) pos -= gapTo - gapFrom;
    }
    return pos;
};

export const pgTextHighlighting = styleTags({
    'MathModeMark ParsedMathModeMark PerlCommandMark': t.processingInstruction,
    'InlineMathMode DisplayMathMode ParsedMathMode': t.atom,
    'Variable EmphasisMark': t.variableName,
    'Emphasis/...': t.emphasis,
    'StrongEmphasis/...': t.strong,
    PGTextError: t.invalid
});

export const parser = new PGTextParser(new NodeSet(nodeTypes).extend(pgTextHighlighting));
