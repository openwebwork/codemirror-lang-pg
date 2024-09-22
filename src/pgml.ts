import type { Input, TreeFragment, TreeCursor, PartialParse } from '@lezer/common';
import { Tree, TreeBuffer, NodeType, NodeProp, NodeSet, Parser } from '@lezer/common';
import { styleTags, tags as t } from '@lezer/highlight';
import { parser as pgPerlParser } from './pg.grammar';
import { Parse, Item } from './pgml-parse';

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
    PGMLContent = 1,

    Paragraph,

    Align,
    AlignMark,
    AnswerRule,
    BulletList,
    Code,
    CodeClass,
    CodeMark,
    CodeText,
    Comment,
    Emphasis,
    EmphasisMark,
    HeaderMark,
    Heading1,
    Heading2,
    Heading3,
    Heading4,
    Heading5,
    Heading6,
    HorizontalRule,
    Image,
    ImageMark,
    ListItem,
    ListMark,
    MathMode,
    MathModeMark,
    Option,
    OptionMark,
    OrderedList,
    PerlCommand,
    PerlCommandMark,
    Pre,
    PreMark,
    StarOption,
    StrongEmphasis,
    Tag,
    TagMark,
    Variable,
    VariableMark,
    Verbatim,
    VerbatimMark
}

// Block-level parsing functions get access to this context object.
class BlockContext implements PartialParse {
    block: CompositeBlock;
    private atEnd = false;
    private fragments: FragmentCursor | null;
    private to: number;
    reusePlaceholders = new Map<Tree, Tree>();
    stoppedAt: number | null = null;

    from: number;
    pos: number; // The currently parsed position.

    content = ''; // The current range content.

    // The start and end of the current range content.
    contentStart: number;
    contentEnd: number;

    // The current parsed postion in the content relative to contentStart,
    // i.e., the position in the current content string.
    contentPos = 0;

    rangeI = 0; // The range index that contentStart points into

    constructor(
        // The parser configuration used.
        readonly parser: PGMLParser,
        readonly input: Input,
        fragments: readonly TreeFragment[],
        readonly ranges: readonly { from: number; to: number }[]
    ) {
        this.from = this.pos = ranges[0].from;
        this.to = ranges[ranges.length - 1].to;
        this.contentStart = this.contentEnd = ranges[0].from;
        this.block = CompositeBlock.create(Type.PGMLContent, this.pos, 0, 0);
        this.fragments = fragments.length ? new FragmentCursor(fragments, input) : null;
        this.readContent();
    }

    get parsedPos() {
        return this.pos;
    }

    advance() {
        if (this.stoppedAt != null && this.contentStart > this.stoppedAt) return this.finish();

        for (;;) {
            if (this.contentPos < this.content.length) break;
            if (!this.nextRangeContent()) return this.finish();
        }

        // FIXME: This is disabled for now. Make it work.
        //if (this.fragments && this.reuseFragment(this.contentPos)) return null;

        const parser = new Parse(this.content);
        if (parser.root) {
            for (const item of parser.root.stack ?? []) {
                if (!(item instanceof Item)) continue;
                for (const elt of pgmlFormat(item, this.from)) {
                    this.addNode(elt.toTree(this.parser.nodeSet), elt.from, elt.to);
                }
            }
        }
        this.contentPos += this.content.length;
        this.pos += this.content.length;

        return null;
    }

    stopAt(pos: number) {
        if (this.stoppedAt != null && this.stoppedAt < pos) throw new RangeError("Can't move stoppedAt forward");
        this.stoppedAt = pos;
    }

    private reuseFragment(start: number) {
        if (
            !this.fragments?.moveTo(this.contentStart + start, this.contentStart) ||
            !this.fragments.matches(this.block.hash)
        )
            return false;
        const taken = this.fragments.takeNodes(this);
        if (!taken) return false;
        this.contentStart += taken;
        this.moveRangeI();
        if (this.contentStart < this.to) {
            ++this.contentStart;
            this.readContent();
        } else {
            this.atEnd = true;
            this.readContent();
        }
        return true;
    }

    // Move to the next input range content.
    nextRangeContent() {
        this.contentStart += this.content.length;
        if (this.contentEnd >= this.to) {
            this.contentStart = this.contentEnd;
            this.atEnd = true;
            this.readContent();
            return false;
        } else {
            this.contentStart = this.contentEnd + 1;
            this.moveRangeI();
            this.readContent();
            return true;
        }
    }

    private moveRangeI() {
        while (this.rangeI < this.ranges.length - 1 && this.contentStart >= this.ranges[this.rangeI].to) {
            ++this.rangeI;
            this.contentStart = Math.max(this.contentStart, this.ranges[this.rangeI].from);
        }
    }

    scanContent() {
        const r = { text: '', end: 0 };
        r.end = this.contentStart;
        if (this.contentStart >= this.to) {
            r.text = '';
        } else {
            r.text = this.contentInRange(this.contentStart, this.ranges[this.rangeI].to);
            r.end += r.text.length;
            if (this.ranges.length > 1) {
                let textOffset = this.contentStart,
                    rangeI = this.rangeI;
                while (this.ranges[rangeI].to < r.end) {
                    ++rangeI;
                    const after = this.contentInRange(this.ranges[rangeI].from, this.ranges[rangeI].to);
                    r.end = this.ranges[rangeI].from + after.length;
                    r.text = r.text.slice(0, this.ranges[rangeI - 1].to - textOffset) + after;
                    textOffset = r.end - r.text.length;
                }
            }
        }
        return r;
    }

    readContent() {
        const { text, end } = this.scanContent();
        this.contentEnd = end;
        this.content = text;
        this.contentPos = 0;
    }

    private contentInRange(start: number, end: number) {
        const text = this.input.read(start, end);
        return start + text.length > this.to ? text.slice(0, this.to - start) : text;
    }

    // The end position of the previous line.
    prevContentEnd() {
        return this.atEnd ? this.contentStart : this.contentStart - 1;
    }

    addNode(block: Type | Tree, from: number, to?: number) {
        if (typeof block == 'number')
            block = new Tree(this.parser.nodeSet.types[block], [], [], (to ?? this.prevContentEnd()) - from);
        this.block.addChild(block, from - this.block.from);
    }

    private finish() {
        return this.block.toTree(this.parser.nodeSet, this.contentStart);
    }

    // Create an [`Element`](#Element) object to represent some syntax node.
    elt(type: string, from: number, to: number, children?: readonly Element[]): Element;
    elt(tree: Tree, at: number): Element;
    elt(type: string | Tree, from: number, to?: number, children?: readonly Element[]): Element {
        if (typeof type == 'string') return elt(this.parser.getNodeType(type), from, to ?? 0, children);
        return new TreeElement(type, from);
    }
}

const pgmlFormat = (block: Item, offset: number): Element[] => {
    if (block.type === 'indent') {
        const paragraphs: Element[] = [];
        const children: Element[] = [];
        let lastEnd = block.from;
        for (const child of block.stack ?? []) {
            if (!(child instanceof Item)) continue;
            if (child.type === 'par') {
                paragraphs.push(elt(Type.Paragraph, lastEnd + offset, child.to + offset, children));
                lastEnd = child.to;
                children.length = 0;
            } else {
                children.push(...pgmlFormat(child, offset));
            }
        }
        if (children.length) paragraphs.push(elt(Type.Paragraph, lastEnd + offset, block.to + offset, children));
        return paragraphs;
    }

    if (['text', 'par', 'break', 'quote', 'forced'].includes(block.type)) return [];

    const children: Element[] = [];
    for (const item of block.stack ?? block.children ?? []) {
        if (!(item instanceof Item) || item.type === 'text') continue;
        children.push(...pgmlFormat(item, offset));
    }

    const options: Element[] = [];
    for (const item of block.optionStack ?? []) {
        options.push(...pgmlFormat(item, offset));
    }

    if (block.type === 'variable') {
        children.unshift(elt(Type.VariableMark, block.from + offset, block.from + 1 + offset));
        children.push(new TreeElement(pgPerlParser.parse(`$${block.text ?? ''}`), block.from + 1 + offset));
        children.push(
            elt(
                Type.VariableMark,
                block.to - 1 - (block.hasStar ? block.hasStar : block.hasDblStar ? 2 : 0) + offset,
                block.to + offset
            )
        );
        return [elt(Type.Variable, block.from + offset, block.to + offset, children)];
    } else if (block.type === 'pre') {
        children.unshift(elt(Type.PreMark, block.from + offset, block.from + (block.token?.length ?? 1) + offset));
        return [elt(Type.Pre, block.from + offset, block.to + offset, children)];
    } else if (block.type === 'verbatim') {
        children.unshift(elt(Type.VerbatimMark, block.from + offset, block.from + (block.token?.length ?? 2) + offset));
        children.push(
            elt(
                Type.VerbatimMark,
                block.to - (block.terminator as string).length - (block.hasStar ?? 0) + offset,
                block.to + offset
            )
        );
        return [elt(Type.Verbatim, block.from + offset, block.to + offset, children)];
    } else if (block.type === 'command') {
        children.unshift(elt(Type.PerlCommandMark, block.from + offset, block.from + 2 + offset));
        children.push(new TreeElement(pgPerlParser.parse(block.text ?? ''), block.from + 2 + offset));
        children.push(
            elt(
                Type.PerlCommandMark,
                block.to - (block.hasStar ? block.hasStar : block.hasDblStar ? 2 : 0) - 2 + offset,
                block.to + offset
            )
        );
        return [elt(Type.PerlCommand, block.from + offset, block.to + offset, children)];
    } else if (block.type === 'comment') {
        return [elt(Type.Comment, block.from + offset, block.to + offset)];
    } else if (block.type === 'answer') {
        const firstOptionBlock = options.at(0);
        return [
            elt(Type.AnswerRule, block.from + offset, firstOptionBlock ? firstOptionBlock.from : block.to + offset),
            ...options
        ];
    } else if (block.type === 'rule') {
        const firstOptionBlock = options.at(0);
        return [
            elt(Type.HorizontalRule, block.from + offset, firstOptionBlock ? firstOptionBlock.from : block.to + offset),
            ...options
        ];
    } else if (block.type === 'math') {
        const firstOptionBlock = options.at(0);
        const to = firstOptionBlock ? firstOptionBlock.from : block.to + offset;
        children.unshift(elt(Type.MathModeMark, block.from + offset, block.from + (block.token?.length ?? 0) + offset));
        children.push(
            elt(
                Type.MathModeMark,
                to - (block.terminator as string).length - (block.hasStar ? block.hasStar : block.hasDblStar ? 2 : 0),
                to
            )
        );
        return [elt(Type.MathMode, block.from + offset, to, children), ...options];
    } else if (block.type === 'image') {
        const firstOptionBlock = options.at(0);
        const to = firstOptionBlock ? firstOptionBlock.from : block.to + offset;
        children.unshift(elt(Type.ImageMark, block.from + offset, block.from + 2 + offset));
        children.push(elt(Type.ImageMark, to - 2, to));
        return [elt(Type.Image, block.from + offset, to, children), ...options];
    } else if (block.type === 'tag') {
        const firstOptionBlock = options.at(0);
        const to = firstOptionBlock ? firstOptionBlock.from : block.to + offset;
        children.unshift(elt(Type.TagMark, block.from + offset, block.from + 2 + offset));
        children.push(elt(Type.TagMark, to - 2, to));
        return [elt(Type.Tag, block.from + offset, to, children), ...options];
    } else if (block.type === 'options') {
        children.unshift(elt(Type.OptionMark, block.from + offset, block.from + 1 + offset));
        if (block.text) children.push(new TreeElement(pgPerlParser.parse(block.text), block.from + 1 + offset));
        children.push(elt(Type.OptionMark, block.to - 1 + offset, block.to + offset));
        return [elt(Type.Option, block.from + offset, block.to + offset, children)];
    } else if (block.type === 'bold' || block.type === 'italic') {
        children.unshift(elt(Type.EmphasisMark, block.from + offset, block.from + 1 + offset));
        children.push(elt(Type.EmphasisMark, block.to - 1 + offset, block.to + offset));
        return [
            elt(
                block.type === 'bold' ? Type.StrongEmphasis : Type.Emphasis,
                block.from + offset,
                block.to + offset,
                children
            )
        ];
    } else if (block.type === 'align') {
        children.unshift(elt(Type.AlignMark, block.from + offset, block.from + (block.token?.length ?? 2) + offset));
        if (typeof block.terminator === 'string')
            children.push(elt(Type.AlignMark, block.to - block.terminator.length + offset, block.to + offset));
        return [elt(Type.Align, block.from + offset, block.to + offset, children)];
    } else if (block.type === 'heading') {
        children.unshift(elt(Type.HeaderMark, block.from + offset, block.from + (block.token?.length ?? 1) + offset));
        if (typeof block.terminator === 'string')
            children.push(elt(Type.HeaderMark, block.to - block.terminator.length + offset, block.to + offset));
        return [
            elt(
                (Type.Heading1.valueOf() - 1 + (block.n ?? 1)) as Type,
                block.from + offset,
                block.to + offset,
                children
            )
        ];
    } else if (block.type === 'list') {
        return [
            elt(
                block.bullet && ['disc', 'square', 'circle', 'bullet'].includes(block.bullet)
                    ? Type.BulletList
                    : Type.OrderedList,
                block.from + offset,
                block.to + offset,
                children
            )
        ];
    } else if (block.type === 'bullet') {
        return [
            elt(Type.ListItem, block.from + offset, block.to + offset, [
                elt(Type.ListMark, block.from + offset, block.from + (block.token?.length ?? 1) + offset),
                elt(Type.Paragraph, block.from + (block.token?.length ?? 1) + offset, block.to + offset, children)
            ])
        ];
    } else if (block.type === 'code') {
        const codeText = block.stack?.[0];
        return [
            elt(Type.Code, block.from + offset, block.to + offset, [
                elt(Type.CodeMark, block.from + offset, block.from + (block.token?.length ?? 1) + offset),
                ...(block.class
                    ? [
                          elt(
                              Type.CodeClass,
                              block.from + (block.token?.length ?? 1) + offset,
                              block.from + (block.token?.length ?? 1) + block.class.length + offset
                          )
                      ]
                    : []),
                ...(codeText instanceof Item ? [elt(Type.CodeText, codeText.from + offset, codeText.to + offset)] : []),
                elt(Type.CodeMark, block.to - (block.terminator as string).length + offset, block.to + offset)
            ])
        ];
    }

    console.log(`unhandled ${block.type}`);
    return children;
};

// A PGML parser configuration.
export class PGMLParser extends Parser {
    nodeTypes = Object.create(null) as Record<string, number>;

    // The parser's syntax [node types](https://lezer.codemirror.net/docs/ref/#common.NodeSet).
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
        props: [
            [NodeProp.group, i === Type.PGMLContent.valueOf() ? ['Block', 'BlockContext'] : ['Block', 'LeafBlock']]
        ],
        top: name == 'PGMLContent'
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
    children: (Element | TreeElement)[] = [];

    constructor(
        // The node's [id](https://lezer.codemirror.net/docs/ref/#common.NodeType.id).
        readonly type: number,
        // The start of the node, as an offset from the start of the document.
        readonly from: number,
        // The end of the node.
        readonly to: number,
        // The node's child nodes
        children: readonly (Element | TreeElement)[] = []
    ) {
        this.children.push(...children);
    }

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

    moveTo(pos: number, contentStart: number) {
        while (this.fragment && this.fragment.to <= pos) this.nextFragment();
        if (!this.fragment || this.fragment.from > pos) return false;
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
            if (c.from >= rPos) return this.fragment.from <= contentStart;
            if (!c.childAfter(rPos)) return false;
        }
    }

    matches(hash: number) {
        return this.cursor?.tree?.prop(NodeProp.contextHash) === hash;
    }

    takeNodes(cx: BlockContext) {
        const cur = this.cursor,
            off = this.fragment?.offset,
            fragEnd = this.fragmentEnd - (this.fragment?.openEnd ? 1 : 0);
        if (!cur || !off) return 0;
        const start = cx.contentStart;
        let end = start,
            blockI = cx.block.children.length;
        for (;;) {
            if (cur.to - off > fragEnd) {
                if (cur.type.isAnonymous && cur.firstChild()) continue;
                break;
            }
            const pos = cur.from - off;
            if (cur.to - off <= cx.ranges[cx.rangeI].to) {
                // Fits in current range
                if (cur.tree) cx.addNode(cur.tree, pos);
            } else {
                const dummy = new Tree(cx.parser.nodeSet.types[Type.Paragraph], [], [], 0, cx.block.hashProp);
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

export const pgmlHighlighting = styleTags({
    Paragraph: t.content,
    'AlignMark CodeMark EmphasisMark HeaderMark ImageMark ListMark MathModeMark OptionMark': t.processingInstruction,
    'PreMark PerlCommandMark TagMark VariableMark VerbatimMark': t.processingInstruction,
    CodeText: t.monospace,
    CodeInfo: t.labelName,
    HorizontalRule: t.contentSeparator,
    'AnswerRule Image MathMode': t.atom,
    'Heading1/...': t.heading1,
    'Heading2/...': t.heading2,
    'Heading3/...': t.heading3,
    'Heading4/...': t.heading4,
    'Heading5/...': t.heading5,
    'Heading6/...': t.heading6,
    'OrderedList/... BulletList/...': t.list,
    Comment: t.lineComment,
    'Emphasis/...': t.emphasis,
    'StrongEmphasis/...': t.strong,
    StarOption: t.controlOperator
});

export const parser = new PGMLParser(new NodeSet(nodeTypes).extend(pgmlHighlighting));
