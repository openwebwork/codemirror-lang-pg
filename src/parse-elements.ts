import type { TreeBuffer, NodeSet } from '@lezer/common';
import { Tree, NodeType, NodeProp } from '@lezer/common';

export class CompositeBlock {
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

export class Buffer<T extends number> {
    content: number[] = [];
    nodes: Tree[] = [];
    constructor(readonly nodeSet: NodeSet) {}

    write(type: T, from: number, to: number, children = 0) {
        this.content.push(type, from, to, 4 + children * 4);
        return this;
    }

    writeElements(elts: readonly (Element<T> | TreeElement<T>)[], offset = 0) {
        for (const e of elts) e.writeTo(this, offset);
        return this;
    }

    finish(type: T, length: number) {
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
export class Element<T extends number> {
    children: (Element<T> | TreeElement<T>)[] = [];

    constructor(
        // The node's [id](https://lezer.codemirror.net/docs/ref/#common.NodeType.id).
        readonly type: number,
        // The start of the node, as an offset from the start of the document.
        readonly from: number,
        // The end of the node.
        readonly to: number,
        // The node's child nodes
        children: readonly (Element<T> | TreeElement<T>)[] = []
    ) {
        this.children.push(...children);
    }

    writeTo(buf: Buffer<T>, offset: number) {
        const startOff = buf.content.length;
        buf.writeElements(this.children, offset);
        buf.content.push(this.type, this.from + offset, this.to + offset, buf.content.length + 4 - startOff);
    }

    toTree(nodeSet: NodeSet): Tree {
        return new Buffer(nodeSet).writeElements(this.children, -this.from).finish(this.type, this.to - this.from);
    }
}

export class TreeElement<T extends number> {
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

    writeTo(buf: Buffer<T>, offset: number) {
        buf.nodes.push(this.tree);
        buf.content.push(buf.nodes.length - 1, this.from + offset, this.to + offset, -1);
    }

    toTree(): Tree {
        return this.tree;
    }
}

export const elt = <T extends number>(
    type: T,
    from: number,
    to: number,
    children?: readonly (Element<T> | TreeElement<T>)[]
) => new Element<T>(type, from, to, children);
