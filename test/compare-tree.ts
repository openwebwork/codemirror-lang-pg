import { Tree, TreeCursor } from '@lezer/common';

interface JSONTreeElement {
    name: string;
    from: number;
    to: number;
    children?: JSONTreeElement[];
}

const compareNode = (cursor: TreeCursor, jsonNode: JSONTreeElement[]) => {
    const firstJsonNode = jsonNode.at(0);
    const name = cursor.name;
    const position = cursor.from;
    if (!firstJsonNode) throw new Error(`Extra node ${name} in tree`);
    else if (name !== firstJsonNode.name)
        throw new Error(`Node type mismatch.  Got: ${name}, Expected: ${firstJsonNode.name}`);
    else if (position != firstJsonNode.from)
        throw new Error(
            `Start position mismatch for ${
                name
            }. Got: ${position.toString()}, Expected: ${firstJsonNode.from.toString()}`
        );
    else if (cursor.to != firstJsonNode.to)
        throw new Error(
            `End position mismatch for ${name}. Got: ${cursor.to.toString()}, Expected: ${firstJsonNode.to.toString()}`
        );
    else {
        const haveChild = cursor.firstChild();
        if (haveChild && !firstJsonNode.children)
            throw new Error(`Expected ${name} at position ${position.toString()} not to have children`);
        else if (!haveChild && firstJsonNode.children)
            throw new Error(`Expected ${name} at position ${position.toString()} to have children`);
        else if (haveChild && firstJsonNode.children) {
            compareNode(cursor, firstJsonNode.children);
            cursor.parent();
        }
    }

    const haveNextSibling = cursor.nextSibling();

    if (!haveNextSibling && jsonNode.at(1)) throw new Error(`Expected ${jsonNode[1].name} after ${name}`);

    if (haveNextSibling) compareNode(cursor, jsonNode.slice(1));
};

export const checkTree = (tree: Tree, jsonTreeString: string) => {
    const cursor = tree.cursor();
    const jsonTree = JSON.parse(jsonTreeString) as JSONTreeElement;
    compareNode(cursor, [jsonTree]);
};
