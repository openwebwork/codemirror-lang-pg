import type { Input, NodePropSource, TreeFragment, PartialParse, Tree } from '@lezer/common';
import { NodeType, NodeProp, NodeSet, Parser } from '@lezer/common';
import { styleTags, tags as t } from '@lezer/highlight';
import type { Element } from './parse-elements';
import { CompositeBlock, TreeElement, elt } from './parse-elements';
import { pgPerlParser } from './pg-parser';
import { PGMLParse, Item } from './pgml-parse';

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
    EscapeSequence,
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
    Table,
    TableCell,
    TableCellMark,
    TableMark,
    Tag,
    TagMark,
    Variable,
    VariableMark,
    Verbatim,
    VerbatimMark,

    PGMLError
}

const nodeProps = new Map<Type, [NodeProp<readonly string[]>, string[]][]>([
    [Type.PGMLContent, [[NodeProp.group, ['Block', 'BlockContext']]]],
    [Type.Paragraph, [[NodeProp.group, ['Block']]]]
]);

const nodeTypes = [NodeType.none];
for (let i = 1, name; (name = Type[i]); ++i) {
    nodeTypes[i] = NodeType.define({
        id: i,
        name,
        props: nodeProps.get(i) ?? [],
        top: name === 'PGMLContent',
        error: name === 'PGMLError'
    });
}

// Block-level parsing functions get access to this context object.
class BlockContext implements PartialParse {
    block: CompositeBlock;
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
        _fragments: readonly TreeFragment[],
        readonly ranges: readonly { from: number; to: number }[]
    ) {
        this.from = this.pos = ranges[0].from;
        this.to = ranges[ranges.length - 1].to;
        this.contentStart = this.contentEnd = ranges[0].from;
        this.block = CompositeBlock.create(Type.PGMLContent, this.pos, 0, 0);
        this.readContent();
    }

    get parsedPos() {
        return this.pos;
    }

    advance() {
        if (
            (this.stoppedAt != null && this.contentStart > this.stoppedAt) ||
            (this.contentPos >= this.content.length && !this.nextRangeContent())
        )
            return this.finish();

        for (const item of new PGMLParse(this.content).root?.stack ?? []) {
            if (!(item instanceof Item)) continue;
            for (const elt of pgmlFormat(item, this.from)) {
                this.addNode(elt.toTree(this.parser.nodeSet), elt.from);
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

    // Move to the next input range content.
    nextRangeContent() {
        this.contentStart += this.content.length;
        if (this.contentEnd >= this.to) {
            this.contentStart = this.contentEnd;
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

    readContent() {
        let end = this.contentStart;
        let text = '';
        if (this.contentStart < this.to) {
            text = this.contentInRange(this.contentStart, this.ranges[this.rangeI].to);
            end += text.length;
            if (this.ranges.length > 1) {
                let textOffset = this.contentStart,
                    rangeI = this.rangeI;
                while (this.ranges[rangeI].to < end) {
                    ++rangeI;
                    const after = this.contentInRange(this.ranges[rangeI].from, this.ranges[rangeI].to);
                    end = this.ranges[rangeI].from + after.length;
                    text = text.slice(0, this.ranges[rangeI - 1].to - textOffset) + after;
                    textOffset = end - text.length;
                }
            }
        }
        this.contentEnd = end;
        this.content = text;
        this.contentPos = 0;
    }

    private contentInRange(start: number, end: number) {
        const text = this.input.read(start, end);
        return start + text.length > this.to ? text.slice(0, this.to - start) : text;
    }

    addNode(block: Tree, from: number) {
        this.block.addChild(block, from - this.block.from);
    }

    private finish() {
        return this.block.toTree(this.parser.nodeSet, this.contentStart);
    }
}

const pgmlFormat = (block: Item, offset: number): Element<Type>[] => {
    if (['text', 'par', 'break', 'quote', 'forced', 'balance'].includes(block.type)) return [];

    const children: Element<Type>[] = [];
    for (const item of block.stack ?? block.children ?? []) {
        if (!(item instanceof Item) || item.type === 'text') continue;
        children.push(...pgmlFormat(item, offset));
    }

    const options: Element<Type>[] = [];
    for (const item of block.optionStack ?? []) {
        options.push(...pgmlFormat(item, offset));
    }

    if (block.type === 'indent') {
        return children.length ? [elt(Type.Paragraph, block.from + offset, block.to + offset, children)] : [];
    } else if (block.type === 'variable') {
        children.unshift(elt(Type.VariableMark, block.from + offset, block.from + 1 + offset));
        if (block.text?.length)
            children.push(new TreeElement(pgPerlParser.parse(`$${block.text}`), block.from + 1 + offset));
        if (typeof block.terminator === 'string')
            children.push(
                elt(
                    Type.VariableMark,
                    block.to - 1 - (block.hasStar ? block.hasStar : block.hasDblStar ? 2 : 0) + offset,
                    block.to + offset
                )
            );
        else children.push(elt(Type.PGMLError, block.to + offset, block.to + offset));
        return [elt(Type.Variable, block.from + offset, block.to + offset, children)];
    } else if (block.type === 'command') {
        children.unshift(elt(Type.PerlCommandMark, block.from + offset, block.from + 2 + offset));
        children.push(
            new TreeElement(pgPerlParser.parse(block.text ?? ''), (block.textFrom ?? block.from + 2) + offset)
        );
        if (typeof block.terminator === 'string')
            children.push(
                elt(
                    Type.PerlCommandMark,
                    block.to - (block.hasStar ? block.hasStar : block.hasDblStar ? 2 : 0) - 2 + offset,
                    block.to + offset
                )
            );
        else children.push(elt(Type.PGMLError, block.to + offset, block.to + offset));
        return [elt(Type.PerlCommand, block.from + offset, block.to + offset, children)];
    } else if (block.type === 'pre') {
        children.unshift(elt(Type.PreMark, block.from + offset, block.from + (block.token?.length ?? 1) + offset));
        return [elt(Type.Pre, block.from + offset, block.to + offset, children)];
    } else if (block.type === 'verbatim') {
        children.unshift(elt(Type.VerbatimMark, block.from + offset, block.from + (block.token?.length ?? 2) + offset));
        if (typeof block.terminator === 'string')
            children.push(
                elt(
                    Type.VerbatimMark,
                    block.to - block.terminator.length - (block.hasStar ?? 0) + offset,
                    block.to + offset
                )
            );
        else children.push(elt(Type.PGMLError, block.to + offset, block.to + offset));
        return [elt(Type.Verbatim, block.from + offset, block.to + offset, children)];
    } else if (block.type === 'comment') {
        return [
            elt(
                Type.Comment,
                block.from + offset,
                block.to + offset,
                block.terminator instanceof RegExp ? [elt(Type.PGMLError, block.to + offset, block.to + offset)] : []
            )
        ];
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
        if (typeof block.terminator === 'string')
            children.push(
                elt(
                    Type.MathModeMark,
                    to - block.terminator.length - (block.hasStar ? block.hasStar : block.hasDblStar ? 2 : 0),
                    to
                )
            );
        else children.push(elt(Type.PGMLError, to + offset, to + offset));
        return [elt(Type.MathMode, block.from + offset, to, children), ...options];
    } else if (block.type === 'table') {
        const firstOptionBlock = options.at(0);
        const to = firstOptionBlock ? firstOptionBlock.from : block.to + offset;
        children.unshift(elt(Type.TableMark, block.from + offset, block.from + (block.token?.length ?? 0) + offset));
        if (typeof block.terminator === 'string')
            children.push(elt(Type.TableMark, to - block.terminator.length - (block.hasStar ?? 0), to));
        else children.push(elt(Type.PGMLError, to, to));
        return [elt(Type.Table, block.from + offset, to, children), ...options];
    } else if (block.type === 'table-cell') {
        const firstOptionBlock = options.at(0);
        const to = firstOptionBlock ? firstOptionBlock.from : block.to + offset;
        children.unshift(
            elt(Type.TableCellMark, block.from + offset, block.from + (block.token?.length ?? 0) + offset)
        );
        if (typeof block.terminator === 'string')
            children.push(elt(Type.TableCellMark, to - block.terminator.length - (block.hasStar ?? 0), to));
        else children.push(elt(Type.PGMLError, to, to));
        return [elt(Type.TableCell, block.from + offset, to, children), ...options];
    } else if (block.type === 'image') {
        const firstOptionBlock = options.at(0);
        const to = firstOptionBlock ? firstOptionBlock.from : block.to + offset;
        children.unshift(elt(Type.ImageMark, block.from + offset, block.from + 2 + offset));
        if (typeof block.terminator === 'string') children.push(elt(Type.ImageMark, to - 2, to));
        else children.push(elt(Type.PGMLError, to, to));
        return [elt(Type.Image, block.from + offset, to, children), ...options];
    } else if (block.type === 'tag') {
        const firstOptionBlock = options.at(0);
        const to = firstOptionBlock ? firstOptionBlock.from : block.to + offset;
        children.unshift(elt(Type.TagMark, block.from + offset, block.from + 2 + offset));
        if (typeof block.terminator === 'string') children.push(elt(Type.TagMark, to - 2, to));
        else children.push(elt(Type.PGMLError, to, to));
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
                typeof block.terminator === 'string'
                    ? elt(Type.CodeMark, block.to - block.terminator.length + offset, block.to + offset)
                    : elt(Type.PGMLError, block.to + offset, block.to + offset)
            ])
        ];
    } else if (block.type === 'slash') {
        return [elt(Type.EscapeSequence, block.from + offset, block.to + offset)];
    }

    console.log(`unhandled ${block.type}`);
    return children;
};

export const pgmlHighlighting = styleTags({
    Paragraph: t.content,
    'AlignMark CodeMark EmphasisMark HeaderMark ImageMark ListMark MathModeMark OptionMark': t.processingInstruction,
    'PreMark PerlCommandMark TableMark TableCellMark TagMark VariableMark VerbatimMark': t.processingInstruction,
    CodeText: t.monospace,
    CodeInfo: t.labelName,
    HorizontalRule: t.contentSeparator,
    EscapeSequence: t.escape,
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
    StarOption: t.controlOperator,
    PGMLError: t.invalid
});

// A PGML parser configuration.
export class PGMLParser extends Parser {
    nodeTypes = Object.create(null) as Record<string, number>;
    readonly nodeSet: NodeSet;

    // The parser's syntax [node types](https://lezer.codemirror.net/docs/ref/#common.NodeSet).
    constructor(props?: NodePropSource[]) {
        super();
        this.nodeSet = new NodeSet(nodeTypes).extend(pgmlHighlighting, ...(props?.length ? props : []));
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
