const warnings: string[] = [];
const warningsFatal = false;

const Warning = (...messages: string[]) => {
    const warning = messages.join('');
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (warningsFatal) {
        console.log(warning);
        process.exit(1);
    }
    warnings.push(warning);
};

const splitPatternParts = [
    '^(?:\\t| {4})+', // indent
    '\\[(?:[!<%@$#.]|::?:?|``?`?|\\|+ ?)', // open
    '\\[(?:_+|[ox^])\\]\\*?', // ansrule
    '(?:[!>%@$#.]|::?:?|``?`?| ?\\|+)\\]', // close
    ' {2,3}(?=\\n)', // linebreak
    '\\n+', // lineend
    '#+', // heading
    '(?:---+|===+)', // rule
    '(?:^|(?<=[\\t ]))(?:[-+o*]|(?:\\d+|[ivxl]+|[IVXL]+|[a-zA-Z])[.)]) +', // list
    '>> *| *<<', // align
    '```', // code
    ': {3}', // pre
    '[$@%]q[qr]?|\\bq[qr]?\\s+(?:#.*?(?:\\n\\s*)+)?(?!=>)(?=.)|\\bq[qr]?(?!=>)(?=\\W)', // quoted
    '\\*+|_+', // emphasis
    '\\[\\]', // noop
    '\\\\.|[{}[\\]()\'"]' // chars
];

const splitPattern = RegExp('(' + splitPatternParts.join('|') + ')', 'm');

type CallableKeyOf<S> = keyof {
    [P in keyof S as S[P] extends (token: string) => void ? P : never]: unknown;
};

const balanceAll = RegExp('[{\\[\'"]');

interface CombineOptions {
    list?: string | { indent: number };
    par?: boolean;
    text?: string;
    indent?: string;
}

interface BlockDefinition {
    type?: string;
    token?: string;
    align?: string;
    allowDblStar?: boolean;
    allowPar?: boolean;
    allowStar?: boolean;
    allowTriStar?: boolean;
    balance?: RegExp;
    breakInside?: boolean;
    cancelNL?: boolean;
    cancelPar?: boolean;
    cancelUnbalanced?: boolean;
    class?: string;
    combine?: CombineOptions;
    container?: string;
    display?: boolean;
    displaystyle?: boolean;
    ignoreIndent?: boolean;
    isContainer?: boolean;
    noIndent?: number;
    options?: string[];
    parseAll?: boolean;
    parseComments?: boolean;
    parseQuoted?: boolean;
    parseSlashes?: boolean;
    parseSubstitutions?: boolean;
    parsed?: boolean;
    terminateMethod?: CallableKeyOf<Parse>;
    terminator?: string | RegExp;
}

interface OriginalBlockDefinition extends BlockDefinition {
    type: string;
}

export class Parse {
    indent = 0;
    actualIndent = 0;
    atLineStart = 1;
    atBlockStart = 1;
    ignoreNL?: number;
    input = '';
    pos = 0;

    block?: Block;
    root?: Root;

    split: (string | undefined)[] = [];
    i = 0;

    constructor(string: string) {
        this.Parse(this.Split(string));
    }

    Split(input: string): (string | undefined)[] {
        this.input = input;
        const split = input.replace(/^(?:\t* +|\t+ *)$/gm, '').split(splitPattern);
        // Need to remove the last entry from split array when a split occurs at the end of the input.
        // Javascript adds that, but Perl doesn't (unless you add the optional limit -1 argument to split).
        if (split.slice(-1)[0] === '') split.pop();
        return split;
    }

    Error(message: string) {
        Warning(`${this.block?.token?.trim() ?? 'unknown block'}: ${message}`);
    }

    Unwind() {
        const block = this.block;
        this.block = block?.prev;
        this.block?.popItem();
        this.Text(block?.token ?? '');
        this.block?.pushItem(...(block?.stack ?? []));
        if (block?.terminator && !(block.terminator instanceof RegExp)) this.Text(block.terminator);
        this.atBlockStart = 0;
    }

    blockError(message: string) {
        this.Error(message);
        this.Unwind();
    }

    isLineEnd(block?: Block) {
        block = block?.prev;
        let i = this.i;
        while (i < this.split.length) {
            if (this.split[i++] !== '') return false;
            const token = this.split[i++] ?? '';
            if (/^\n+$/.test(token)) break;
            if (/^ {2,3}$/.test(token)) continue;
            if (!/^ +<<$/.test(token) || !block?.align) return false;
            block = block.prev;
        }
        return true;
    }

    nextChar(defaultNext?: string) {
        if (typeof defaultNext === 'undefined') defaultNext = '';
        return (this.split[this.i] ?? this.split[this.i + 1] ?? defaultNext).substring(0, 1);
    }

    prevChar(defaultPrev?: string) {
        if (typeof defaultPrev === 'undefined') defaultPrev = '';
        let i2 = this.i - 2;
        if (i2 < 0) i2 = 0;
        let i3 = this.i - 3;
        if (i3 < 0) i3 = 0;
        return (this.split[i2] ?? this.split[i3] ?? defaultPrev).substring(-1, 1);
    }

    Parse(split: (string | undefined)[]) {
        this.split = split;
        let block: Block;
        this.i = 0;
        this.pos = 0;
        this.block = this.root = new Root(this);

        while (this.i < this.split.length) {
            block = this.block;

            this.pos += this.split[this.i]?.length ?? 0;
            this.Text(this.split[this.i++] ?? '');

            const token = this.split[this.i++];
            if (typeof token === 'undefined' || token === '') continue;
            if (
                block.terminator &&
                RegExp(`^${block.terminator instanceof RegExp ? block.terminator.source : block.terminator}$`).test(
                    token
                )
            )
                this.Terminate(token);
            else if (
                block.containerEnd &&
                RegExp(
                    `^${block.containerEnd instanceof RegExp ? block.containerEnd.source : block.containerEnd}$`
                ).test(token)
            )
                this.EndContainer(token);
            else if (/^\[[@$]/.test(token) && (block.parseAll || block.parseSubstitutions)) this.Begin(token);
            else if (token.startsWith('[%') && (block.parseAll || block.parseComments)) this.Begin(token);
            else if (/^\\./.test(token) && (block.parseAll || block.parseSlashes)) this.Slash(token);
            else if (/^\n$/.test(token)) this.Break(token);
            else if (/^\n\n+$/.test(token)) this.Par(token);
            else if (/^\*\*?$/.test(token) && !block.parseAll && block.parseSubstitutions) this.Star(token);
            else if (block.parseQuoted && token.startsWith('q')) this.Quoted(token);
            else if (block.balance && RegExp(`^${block.balance.source}`).test(token))
                this.Begin(token, token.substring(0, 1));
            else if (block.balance && RegExp(`${block.balance.source}$`).test(token))
                this.Begin(token, token.substring(token.length - 1));
            else if (block.parseAll) this.All(token);
            else if (/^[}\]]$/.test(token)) this.Unbalanced(token);
            else this.Text(token);

            if (token.includes('\n\n')) {
                for (let i = 0; i < token.length; ++i) {
                    ++this.pos;
                    if (token[i] !== '\n' || token[i + 1] !== '\n') continue;
                    while (this.input[this.pos] === ' ' || this.input[this.pos] === '\t') ++this.pos;
                }
            } else {
                this.pos += token.length;
            }
        }

        this.End('END_PGML');
        this.root.to = this.pos;
        delete this.root.parser;
    }

    All(token: string) {
        if (token.startsWith('[') && BlockDefs[token]) this.Begin(token);
        else if (/^(?:\t| {4})/.test(token)) this.Indent(token);
        else if (/\d+[.)] /.test(token)) this.Bullet(token, 'numeric');
        else if (/[ivxl]+[.)] /.test(token)) this.Bullet(token, 'roman');
        else if (/[a-z][.)] /.test(token)) this.Bullet(token, 'alpha');
        else if (/[IVXL]+[.)] /.test(token)) this.Bullet(token, 'Roman');
        else if (/[A-Z][.)] /.test(token)) this.Bullet(token, 'Alpha');
        else if (/[-+o*] /.test(token)) this.Bullet(token, 'bullet');
        else if (token.includes('{')) this.Brace(token);
        else if (token.includes('[]')) this.NOOP(token);
        else if (token.includes('[|')) this.Verbatim(token);
        else if (token.includes('[!')) this.Image(token);
        else if (/\[./.test(token)) this.Answer(token);
        else if (token.includes('_')) this.Emphasis(token);
        else if (token.includes('*')) this.Star(token);
        else if (/["']/.test(token)) this.Quote(token);
        else if (/^ {2,3}$/.test(token)) this.ForceBreak(token);
        else if (token.includes('#')) this.Heading(token);
        else if (/-|=/.test(token)) this.Rule(token);
        else if (token.includes('<<')) this.Center(token);
        else if (token.includes('>>')) this.Align(token);
        else if (token.includes('```')) this.Code(token);
        else if (token.includes(':   ')) this.Preformatted(token);
        else this.Text(token);
    }

    Begin(token: string, id: string = token, options: { terminator?: RegExp; bullet?: string; n?: number } = {}) {
        const def: BlockDefinition = { ...BlockDefs[id], ...options, token };
        const type = BlockDefs[id]?.type ?? 'text';
        const blockClass = blockClasses.get(def.class ?? 'Block') ?? Block;
        delete def.type;
        delete def.class;
        const block = new blockClass(type, this.pos, def);
        const end = this.block?.isContainer ? this.block.terminator : this.block?.containerEnd;
        if (end) block.containerEnd = end;

        if (block.container && this.block?.type !== block.container) {
            Warning(`A ${type} must appear in a ${block.container}`);
            block.hasWarning = true;
        }

        this.block?.pushItem(block);
        block.prev = this.block;
        this.block = block;
        this.atLineStart = 0;
        this.atBlockStart = 1;
    }

    End(action: string | undefined, endAt?: Block) {
        if (typeof action === 'undefined') action = 'paragraph ends';
        let block = this.block;
        if (block?.isContainer) return;
        const topItem = block?.topItem();
        if (topItem instanceof Block && topItem.type === 'break' && block?.type !== 'align') block?.popItem();
        while (block?.type !== 'root') {
            if (block?.terminator instanceof RegExp || block?.cancelPar)
                this.blockError(`block not closed before ${action}`);
            else this.Terminate();
            if (endAt && endAt === block) return;
            block = this.block;
        }
    }

    Terminate(token?: string) {
        const block = this.block;
        if (!block) return;
        const prev = block.prev;
        if (typeof token === 'string') {
            block.terminator = token;
            block.to += block.terminator.length;
            if (block.terminateMethod) this[block.terminateMethod](token);
        }
        if (prev && (block.type !== 'pre' || prev.to < block.to)) prev.to = block.to;
        delete block.prev;
        delete block.parseComments;
        delete block.parseSubstitutions;
        delete block.parseSlashes;
        delete block.parseAll;
        delete block.cancelUnbalanced;
        delete block.cancelNL;
        delete block.cancelPar;
        delete block.balance;
        delete block.terminateMethod;
        delete block.noIndent;
        delete block.ignoreIndent;
        this.block = prev;
        if (block.stack && prev) {
            if (block.stack.length == 0) prev.popItem();
            else if (block.combine) prev.combineTopItems();
        }
    }

    EndContainer(token: string) {
        while (!this.block?.isContainer) this.Terminate(token);
        this.Terminate(token);
    }

    Unbalanced(token: string) {
        if (this.block?.cancelUnbalanced) this.blockError(`parenthesis mismatch: block terminated by ${token}`);
        this.Text(token);
    }

    Text(text: string, force?: boolean) {
        if (text !== '' || force) {
            this.block?.pushText(text, force);
            this.atLineStart = this.atBlockStart = this.ignoreNL = 0;
        }
    }

    Item(type: string, token: string, options: { noIndent?: number; options?: string[]; hasStar?: number } = {}) {
        const def = { ...options, token };
        const top = this.block?.topItem();
        this.block?.pushItem(new Item(type, top instanceof Item ? top.to : this.block.to, def));
        this.atBlockStart = 0;
    }

    Break(token: string) {
        if (this.ignoreNL) {
            if (this.block) this.block.to += 1;
            const top = this.block?.topItem();
            if (top instanceof Item) top.to += 1;
            this.ignoreNL = 0;
        } else {
            while (this.block?.cancelNL) this.blockError('block not closed before line break');
            const top = this.block?.topItem();
            if (top && top instanceof Block && top.breakInside) top.pushText(token);
            else this.Text(token);
            this.ignoreNL = 1;
        }
        this.atLineStart = 1;
        this.actualIndent = 0;
    }

    ForceBreak(token: string) {
        while (this.block?.cancelNL) this.blockError('block not closed before forced break');
        if (token === '   ') {
            this.End('forced break');
            this.Item('forced', token, { noIndent: 1 });
            this.indent = 0;
        } else {
            const top = this.block?.topItem() as Block;
            if (top.breakInside) top.pushItem(new Item('break', this.pos, { token }));
            else this.Item('break', token, { noIndent: 1 });
        }
        this.atLineStart = this.ignoreNL = 1;
        this.actualIndent = 0;
    }

    Par(token: string, endAt?: Block) {
        if (this.block?.allowPar) {
            this.Text('\n\n');
        } else {
            this.End(undefined, endAt);
            this.Item('par', token, { noIndent: 1 });
            this.atLineStart = this.ignoreNL = 1;
            this.indent = this.actualIndent = 0;
        }
    }

    Indent(token: string) {
        if (this.block && (this.block.ignoreIndent || this.atLineStart)) this.block.to += token.length;
        if (this.block?.ignoreIndent) return;
        if (this.atLineStart) {
            const tabs = token.replace(/ {4}/g, '\t'); // turn spaces into tabs
            const indent = (this.actualIndent = tabs.length);
            const top = this.block?.topItem();
            if (top && top instanceof Text) top.to += token.length;
            if (indent !== this.indent) {
                this.End('indentation change');
                this.indent = indent;
            }
        } else {
            this.Text(token);
        }
    }

    Slash(token: string) {
        this.Text(token);
    }

    Brace(token: string) {
        const top = this.block?.topItem();
        if (top instanceof Item && top.options) this.Begin(token, ' {');
        else this.Text(token);
    }

    Verbatim(token: string) {
        let bars = token;
        bars = bars.replace(/[^|]/g, '');
        bars = '\\' + bars.split('').join('\\');
        this.Begin(token, ' [|', { terminator: RegExp(` ?${bars}\\]`) });
    }

    Image(token: string) {
        this.Item('image', token);
    }

    Answer(token: string) {
        const def: Fields = { options: ['answer', 'width', 'name', 'cmp_options'] };
        if (token.endsWith('*')) def.hasStar = 1;
        this.Item('answer', token, def);
    }

    Emphasis(token: string) {
        const type = BlockDefs[token.substring(0, 1)]?.type;
        let block = this.block;
        if (block && block.type === type) {
            block.to += 1;
            this.Terminate();
            return;
        }
        while (block?.type !== 'root') {
            if (block && block.prev?.type === type) {
                this.End(`end of ${type ?? ''}`, block);
                block.to += 1;
                this.Terminate();
                return;
            }
            block = block?.prev;
        }
        if (!/\s/.test(this.nextChar(' ')) && (type === 'bold' || !/[a-z0-9]/i.test(this.prevChar(' ')))) {
            this.Begin(token, token.substring(0, 1));
        } else {
            this.Text(token);
        }
    }

    Star(token: string) {
        if (this.StarOption(token)) return;
        if (this.block?.parseAll) this.Emphasis(token);
        else this.Text(token);
    }

    Rule(token: string) {
        if (this.atLineStart) {
            // check for line end or braces
            this.Item('rule', token, { options: ['width', 'height', 'size'] });
            this.ignoreNL = 1;
        } else {
            this.Text(token);
        }
    }

    Bullet(token: string, bullet: string) {
        if (!this.atLineStart) {
            this.Text(token);
            return;
        }
        if (bullet === 'bullet')
            bullet = { '*': 'disc', '+': 'square', o: 'circle', '-': 'bullet' }[token.substring(0, 1)] ?? 'bullet';
        let block = this.block;
        if (block?.type !== 'root' && !block?.align) {
            while (block?.type !== 'root' && !block?.prev?.align) block = block?.prev;
            this.End('start of list item', block);
        }
        this.indent = this.actualIndent;
        this.Begin('', 'list', { bullet });
        this.Begin(token, 'bullet');
    }

    Heading(token: string) {
        const n = token.length;
        if (n > 6) {
            this.Text(token);
            return;
        }
        let block = this.block;
        if (this.atLineStart) {
            if (block?.type !== 'root' && block?.type !== 'align') {
                while (block && block.type !== 'root' && block.prev?.type !== 'align') block = block.prev;
                this.End('start of heading', block);
            }
            this.Begin(token, '#', { n });
        } else {
            while (block && (block.type !== 'heading' || block.n != n)) {
                if (block.type === 'root') {
                    this.Text(token);
                    return;
                }
                block = block.prev;
            }
            if (this.isLineEnd(block)) {
                if (block) block.to += token.length;
                this.End('end of heading', block);
                if (block) block.terminator = token;
                this.indent = 0;
            } else {
                this.Text(token);
            }
        }
    }

    Center(token: string) {
        let block = this.block;
        while (block && (!block.align || block.align !== 'right')) {
            if (block.type === 'root') {
                this.Text(token);
                return;
            }
            block = block.prev;
        }
        if (this.isLineEnd(block)) {
            if (block) {
                block.align = 'center';
                block.terminator = token;
                block.to += token.length;
            }
            this.End('end of centering', block);
        } else {
            this.Text(token);
        }
    }

    Align(token: string) {
        if (!this.atLineStart || (this.block?.type === 'align' && this.atBlockStart)) {
            this.Text(token);
            return;
        }
        this.End('start of aligned text');
        this.indent = this.actualIndent;
        this.Begin(token, '>>');
        this.atLineStart = this.ignoreNL = 1;
    }

    Code(token: string) {
        if (!this.atLineStart || (this.block?.type === 'code' && this.atBlockStart)) {
            this.Text(token);
            return;
        }
        this.End('start of preformatted code');
        this.indent = this.actualIndent;
        this.Begin(token, '```');
    }

    Preformatted(token: string) {
        if (!this.atLineStart || (this.block?.type === 'pre' && this.atBlockStart)) {
            this.Text(token);
            return;
        }
        this.End('start of preformatted text');
        this.indent = this.actualIndent;
        this.Begin(token, ':   ');
    }

    Quoted(token: string) {
        const next = this.split[this.i] ?? this.split[++this.i] ?? '';
        const quote = next.substring(0, 1);
        this.split[this.i] = next.substring(1);
        let pcount = 0;
        const open = /[({[<]/.test(quote) ? quote : '';
        const close = open || quote;
        close.replaceAll(/\(\{\[</g, (match) =>
            match === '(' ? ')' : match === '{' ? '}' : match === '[' ? ']' : match === '<' ? '>' : ''
        );
        const qclose = `\\${close}`;
        this.Text(token + quote);

        while (this.i < this.split.length) {
            const text = this.split[this.i] ?? '';
            if (open && text === open) {
                ++pcount;
            } else if (open && text === close && pcount > 0) {
                --pcount;
            } else if (pcount == 0 && text !== qclose) {
                const i = text.indexOf(close);
                if (i > -1) {
                    this.Text(text.substring(0, i + 1));
                    this.split[this.i] = text.substring(i + 1);
                    if (this.i % 2) this.Text(this.split[++this.i] ?? '');
                    return;
                }
            }
            this.Text(text);
            ++this.i;
        }
    }

    Quote(token: string) {
        this.Item('quote', token);
    }

    NOOP(_token: string) {
        this.Text('', true);
    }

    terminateGetString(_token: string) {
        const block = this.block;
        if (!block) return;
        if (block.type === 'math' || block.type === 'image') {
            for (const child of block.stack ?? []) {
                if (child instanceof Text) {
                    const lastChild = block.children?.at(-1);
                    if (lastChild instanceof Text) lastChild.pushItem(...(child.stack as string[]));
                    else block.pushChild(child);
                } else if (!(child instanceof Item)) {
                    const lastChild = block.children?.at(-1);
                    if (lastChild instanceof Text) lastChild.pushText(child);
                    else block.pushChild(new Text(lastChild?.to ?? block.to, child));
                } else {
                    block.pushChild(child);
                }
            }
            delete block.stack;
            for (const child of block.children ?? []) {
                if (child instanceof Text) {
                    child.stack = [child.stack?.join('') ?? ''];
                }
            }
        } else {
            block.text = this.stackString();
            delete block.stack;
        }
    }

    terminateBalance(_token: string) {
        const block = this.block;
        if (!block?.stack || block.stack.length == 0) this.Text('', true);
        const stackString = this.stackString();
        this.block = block?.prev;
        this.block?.popItem();
        if (block?.token === '"' || block?.token === "'") {
            this.Item('quote', block.token);
            this.Text(stackString);
            this.Item('quote', block.terminator as string);
        } else {
            this.Text((block?.token ?? '') + stackString + (block?.terminator as string));
        }
    }

    terminateCode(_token: string) {
        if (!this.block) return;
        const top = this.block.topItem();
        if (top instanceof Text && top.type === 'text') {
            const topText = top.stack?.at(0);
            const pentUltimateText = top.stack?.at(1);
            if (
                typeof topText === 'string' &&
                /^ *[a-z0-9]+$/.test(topText) &&
                typeof pentUltimateText === 'string' &&
                /^\n+$/.test(pentUltimateText)
            ) {
                this.block.class = topText.replace(/^ +/, '');
                top.stack?.shift();
                top.from += topText.length;
            }
        }
    }

    terminatePre(token: string) {
        if (this.block) this.block.terminator = ''; // the ending token is added to the text below
        if (this.block) this.block.to -= token.length;
        if (token.includes('\n\n')) {
            this.Par(token, this.block);
            this.block = this.block?.prev;
        } else {
            this.Text(token);
            this.atLineStart = 1;
            this.actualIndent = 0;
        }
    }

    terminateOptions(_token: string) {
        this.block = this.block?.prev;
        const optionBlock = this.block?.popItem();
        const block = this.block?.topItem();
        if (!(block instanceof Item) || !(optionBlock instanceof Item)) return;
        optionBlock.text = this.stackText(optionBlock.stack);
        delete optionBlock.stack;
        block.pushOption(optionBlock);
        block.to = optionBlock.to;
    }

    StarOption(token: string) {
        const top = this.block?.topItem();
        if (!top || !(top instanceof Item)) return false;
        if (token === '*' && top.allowStar) {
            top.hasStar = 1;
            top.to += 1;
            if (this.block) this.block.to = top.to;
            return true;
        }
        if (token === '**' && top.allowDblStar) {
            top.hasDblStar = true;
            top.to += 2;
            if (this.block) this.block.to = top.to;
            return true;
        }
        if (token === '***' && top.allowTriStar) {
            top.hasStar = 3;
            top.to += 3;
            if (this.block) this.block.to = top.to;
            return true;
        }
        return false;
    }

    stackText(stack?: (string | Item)[]): string {
        if (!stack) return '';
        const strings = [];
        for (const item of stack) {
            if (!(item instanceof Item)) continue;
            if (item.type === 'text') strings.push(this.replaceText(item));
            else if (item.type === 'quote') strings.push(this.replaceQuote(item));
            else if (item.type === 'variable') strings.push(this.replaceVariable(item));
            else if (item.type === 'command') strings.push(this.replaceCommand(item));
            else if (item.type === 'balance') strings.push(this.replaceBalance(item));
            else Warning(`Warning: unexpected type ${item.type} in stackText`);
        }
        return strings.join('');
    }

    stackString() {
        return this.stackText(this.block?.stack);
    }

    replaceBalance(item: Item) {
        return `${item.token ?? ''}${this.stackText(item.stack)}${
            item.terminator instanceof RegExp ? item.terminator.source : (item.terminator ?? '')
        }`;
    }

    replaceText(item: Item) {
        return item.stack?.join('') ?? '';
    }

    replaceQuote(item: Item) {
        return item.token ?? '';
    }

    replaceVariable(item: Item) {
        return `$${item.text ?? ''}`;
    }

    replaceCommand(item: Item) {
        return item.text ?? '';
    }
}

interface Fields extends BlockDefinition {
    parser?: Parse;
    stack?: (Item | string)[];
    prev?: Block;
    hasStar?: number;
    indent?: number;
    noIndent?: number;
    options?: string[];
    bullet?: string;
    n?: number;
}

export class Item implements BlockDefinition {
    to: number;
    token?: string;
    stack?: (Item | string)[];
    children?: Item[];
    optionStack?: Item[];
    text?: string;
    hasWarning?: boolean;
    bullet?: string;
    hasDblStar?: boolean;
    hasStar?: number;
    indent?: number;
    n?: number;

    align?: string;
    allowDblStar?: boolean;
    allowPar?: boolean;
    allowStar?: boolean;
    allowTriStar?: boolean;
    balance?: RegExp;
    breakInside?: boolean;
    cancelNL?: boolean;
    cancelPar?: boolean;
    cancelUnbalanced?: boolean;
    class?: string;
    combine?: CombineOptions;
    container?: string;
    display?: boolean;
    displaystyle?: boolean;
    ignoreIndent?: boolean;
    isContainer?: boolean;
    noIndent?: number;
    options?: string[];
    parseAll?: boolean;
    parseComments?: boolean;
    parseQuoted?: boolean;
    parseSlashes?: boolean;
    parseSubstitutions?: boolean;
    parsed?: boolean;
    terminateMethod?: CallableKeyOf<Parse>;
    terminator?: string | RegExp;

    constructor(
        public type: string,
        public from: number,
        fields: Fields = {}
    ) {
        Object.assign(this, fields);
        this.to = this.from + (this.token?.length ?? 0);
    }

    pushChild(child: Item) {
        if (!(this.children instanceof Array)) this.children = [];
        this.children.push(child);
    }

    pushOption(child: Item) {
        if (!(this.optionStack instanceof Array)) this.optionStack = [];
        this.optionStack.push(child);
    }

    quote(input: string) {
        input = input.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
        return input;
    }

    stringifyObject(obj: object): string {
        return (
            '{ ' +
            Object.entries(obj)
                .sort((a, b) => (a[0] < b[0] ? -1 : a[0] === b[0] ? 0 : 1))
                .map(
                    ([k, v]) =>
                        `${k}: ${
                            typeof v === 'object'
                                ? this.stringifyObject(v as object)
                                : // eslint-disable-next-line @typescript-eslint/no-base-to-string
                                  `'${this.quote((v as object).toString())}'`
                        }`
                )
                .join(', ') +
            ' }'
        );
    }

    show(indent?: string): string {
        if (!indent) indent = '';
        const strings = [];
        for (const id of Object.keys(this).sort()) {
            if (id === 'stack' || !Object.hasOwn(this, id)) continue;
            const value = this[id as keyof Item];
            if (typeof value === 'undefined') continue;
            if (value instanceof Array && (id === 'children' || id === 'optionStack')) {
                strings.push(
                    `${indent}${id}: [\n${indent}  {\n${value
                        .map((e) => (e as Item).show(`${indent}    `))
                        .join(`\n${indent}  },\n${indent}  {\n`)}\n${indent}  }\n${indent}]`
                );
            } else if (value instanceof Array) {
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                strings.push(`${indent}${id}: [${value.map((e) => `'${this.quote(e.toString())}'`).join(', ')}]`);
            } else if (typeof value === 'object' && !(value instanceof RegExp)) {
                strings.push(`${indent}${id}: ${this.stringifyObject(value)}`);
            } else {
                strings.push(`${indent}${id}: '${this.quote(value.toString())}'`);
            }
        }
        return strings.join('\n');
    }
}

export class Block extends Item {
    prev?: Block;
    containerEnd?: string | RegExp;

    constructor(type: string, from: number, fields: Fields = {}) {
        super(type, from, { ...fields, stack: [] });
        if ('prev' in fields) this.prev = fields.prev;
    }

    pushText(text: string, force?: boolean) {
        if (text === '' && !force) return;
        const top = this.topItem();
        if (top instanceof Text) {
            top.pushText(text);
            this.to += text.length;
        } else {
            this.pushItem(new Text(this.to, text));
        }
    }

    pushItem(...items: (string | Item)[]) {
        this.to = items.reduce((max, i) => {
            const to = i instanceof Item ? i.to : i.length;
            return to > max ? to : max;
        }, 0);
        this.stack?.push(...items);
    }

    topItem(i = -1) {
        return this.stack?.at(i) ?? new Block('null', this.to);
    }

    popItem() {
        return this.stack?.pop();
    }

    // FIXME: There are a lot of hacks in this method.
    combineTopItems(i?: number) {
        if (typeof i === 'undefined') i = -1;
        const top = this.topItem(i) as Block;
        let prev = this.topItem(i - 1) as Block;
        let par;
        for (let j = i - 1; prev.type === 'par' && top.combine?.par; --j) {
            par = prev;
            prev = this.topItem(j) as Block;
        }

        let id = top.combine?.[prev.type as keyof CombineOptions];
        let value: number;
        let inside = false;
        if (id) {
            if (typeof id !== 'string' && typeof id !== 'boolean') {
                [id, value] = Object.entries(id)[0];
                inside = true;
            } else {
                value = prev[id as keyof Item] as number;
            }
            const topList = top instanceof Block ? ((top.topItem() as Block).token?.substring(0, 2) ?? '') : '';
            const prevList = prev instanceof Block ? ((prev.topItem() as Block).token?.substring(0, 2) ?? '') : '';
            if (
                top[id as keyof Item] === value ||
                (top.type === 'list' &&
                    top.bullet === 'roman' &&
                    prev.type === 'list' &&
                    prev.bullet === 'alpha' &&
                    ((topList === 'i.' && prevList === 'h.') ||
                        (topList === 'v.' && prevList === 'u.') ||
                        (topList === 'x.' && prevList === 'w.') ||
                        (topList === 'l.' && prevList === 'k.'))) ||
                (top.type === 'list' &&
                    top.bullet === 'Roman' &&
                    prev.type === 'list' &&
                    prev.bullet === 'Alpha' &&
                    ((topList === 'I.' && prevList === 'H.') ||
                        (topList === 'V.' && prevList === 'U.') ||
                        (topList === 'X.' && prevList === 'W.') ||
                        (topList === 'L.' && prevList === 'K.')))
            ) {
                // Combine identical blocks
                if (inside) prev = prev.topItem() as Block;
                this.stack?.splice(i, 1);
                if (par) {
                    this.stack?.splice(i, 1);
                    prev.pushItem(par);
                }
                i = -(top.stack?.length ?? 0);
                prev.pushItem(...(top.stack ?? []));
                if (prev.type !== 'text' && (prev.topItem(i) as Block).combine) prev.combineTopItems(i);
                return;
            } else if (
                top.type === 'indent' &&
                prev.type === 'indent' &&
                (top.indent ?? 0) > (prev.indent ?? 0) &&
                (prev.indent ?? 0) > 0
            ) {
                // Move larger indentations into smaller ones
                this.stack?.splice(i, 1);
                if (par) {
                    this.stack?.splice(i, 1);
                    prev.pushItem(par);
                }
                if (typeof top.indent === 'undefined') top.indent = 0;
                top.indent -= prev.indent ?? 0;
                prev.pushItem(top);
                prev.combineTopItems();
                return;
            } else if (id === 'indent' && top.type === 'indent' && prev.type === 'list') {
                prev = prev.topItem() as Block;
                if ((top.indent ?? 0) > value && value > 0) {
                    this.stack?.splice(i, 1);
                    if (par) {
                        this.stack?.splice(i, 1);
                        prev.pushItem(par);
                    }
                    if (typeof top.indent === 'undefined') top.indent = 0;
                    top.indent -= value;
                    prev.pushItem(top);
                    prev.combineTopItems();
                }
            }
        }
    }

    show(indent?: string) {
        if (!indent) indent = '';
        const strings = [super.show(indent)];
        if (this.stack) {
            strings.push(`${indent}stack: [`);
            for (let i = 0; i < this.stack.length; ++i) {
                const item = this.stack[i];
                if (item instanceof Item) {
                    strings.push(`${indent}  [ # ${i.toString()}`);
                    strings.push(item.show(`${indent}    `));
                    strings.push(`${indent}  ]`);
                } else {
                    strings.push(`${indent}  ${i.toString()}: '${item}'`);
                }
            }
            strings.push(`${indent}]`);
        }
        return strings.join('\n');
    }
}

class Root extends Block {
    parser?: Parse;

    constructor(parser: Parse) {
        super('root', 0, { parseAll: true, parser });
        this.parser = parser;
    }

    pushItem(...items: Item[]) {
        const parser = this.parser;
        if (!parser) return;

        let item;
        while ((item = items.pop())) {
            if (!item.noIndent || (parser.indent && item.noIndent < 0)) {
                parser.block = new Block('indent', item.from, {
                    prev: this,
                    indent: parser.indent,
                    parseAll: true,
                    combine: { indent: 'indent', list: { indent: 1 }, par: true }
                });
                parser.block.pushItem(item, ...items);
                items.length = 0;
                item = parser.block;
            }
            this.to = item.to;
            this.stack?.push(item);
        }
    }
}

export class Table extends Block {
    pushItem(...items: Item[]) {
        let item;
        while ((item = items.pop())) {
            if (item.type === 'text') {
                const text = item.stack?.join('') ?? '';
                if (!/^\s*$/.test(text)) Warning('Table text must be in cells');
            } else if (item.type === 'table-cell' || item.type === 'options') {
                super.pushItem(item);
            } else if (item.type === 'comment') {
                // ignore
            } else {
                Warning('Tables can contain only table cells');
            }
        }
    }
}

export class Text extends Item {
    constructor(from: number, ...texts: string[]) {
        super('text', from, { stack: [...texts], combine: { text: 'type' } });
        this.to += texts.join('').length;
    }

    pushText(...texts: string[]) {
        this.to += texts.join('').length;
        for (const text of texts) {
            if (text !== '') this.stack?.push(text);
        }
    }

    pushItem(...texts: string[]) {
        this.pushText(...texts);
    }

    show(indent?: string) {
        if (!indent) indent = '';
        const strings = [super.show(indent)];
        if (this.stack)
            strings.push(
                `${indent}stack: [${this.stack
                    .map((e) => (typeof e === 'string' ? `'${this.quote(e)}'` : 'bad item in Text stack'))
                    .join(', ')}]`
            );
        return strings.join('\n');
    }
}

const blockClasses = new Map([
    ['Block', Block],
    ['Table', Table]
]);

const BlockDefs: Record<string, OriginalBlockDefinition | undefined> = {
    '[#': {
        type: 'table',
        class: 'Table',
        parseAll: true,
        ignoreIndent: true,
        allowPar: true,
        terminator: RegExp('#\\]'),
        allowStar: true,
        options: [
            'center',
            'caption',
            'horizontalrules',
            'texalignment',
            'align',
            'Xratio',
            'encase',
            'rowheaders',
            'headerrules',
            'valign',
            'padding',
            'tablecss',
            'captioncss',
            'columnscss',
            'datacss',
            'headercss',
            'allcellcss',
            'booktabs'
        ]
    },
    '[.': {
        type: 'table-cell',
        parseAll: true,
        isContainer: true,
        container: 'table',
        terminator: RegExp('\\.\\]'),
        allowStar: true,
        options: [
            'halign',
            'header',
            'color',
            'bgcolor',
            'b',
            'i',
            'm',
            'noencase',
            'colspan',
            'top',
            'bottom',
            'cellcss',
            'texpre',
            'texpost',
            'texencase',
            'rowcolor',
            'rowcss',
            'headerrow',
            'rowtop',
            'rowbottom',
            'valign',
            'rows'
        ]
    },
    '[:': {
        type: 'math',
        parseComments: true,
        parseSubstitutions: true,
        terminator: RegExp(':\\]'),
        terminateMethod: 'terminateGetString',
        parsed: true,
        allowStar: true,
        allowDblStar: true,
        allowTriStar: true,
        options: ['context', 'reduced']
    },
    '[::': {
        type: 'math',
        parseComments: true,
        parseSubstitutions: true,
        terminator: RegExp('::\\]'),
        terminateMethod: 'terminateGetString',
        parsed: true,
        allowStar: true,
        allowDblStar: true,
        allowTriStar: true,
        displaystyle: true,
        options: ['context', 'reduced']
    },
    '[:::': {
        type: 'math',
        parseComments: true,
        parseSubstitutions: true,
        terminator: RegExp(':::\\]'),
        terminateMethod: 'terminateGetString',
        parsed: true,
        allowStar: true,
        allowDblStar: true,
        allowTriStar: true,
        display: true,
        options: ['context', 'reduced']
    },
    '[`': {
        type: 'math',
        parseComments: true,
        parseSubstitutions: true,
        terminator: RegExp('\\`\\]'),
        terminateMethod: 'terminateGetString'
    },
    '[``': {
        type: 'math',
        parseComments: true,
        parseSubstitutions: true,
        terminator: RegExp('\\`\\`\\]'),
        terminateMethod: 'terminateGetString',
        displaystyle: true
    },
    '[```': {
        type: 'math',
        parseComments: true,
        parseSubstitutions: true,
        terminator: RegExp('\\`\\`\\`\\]'),
        terminateMethod: 'terminateGetString',
        display: true
    },
    '[!': {
        type: 'image',
        parseComments: true,
        parseSubstitutions: true,
        terminator: RegExp('!]'),
        terminateMethod: 'terminateGetString',
        cancelNL: true,
        options: ['source', 'width', 'height', 'image_options']
    },
    '[<': {
        type: 'tag',
        parseAll: true,
        isContainer: true,
        terminator: RegExp('>\\]'),
        options: ['html', 'tex', 'ptx']
    },
    '[%': { type: 'comment', parseComments: true, terminator: RegExp('%\\]'), allowPar: true },
    '[@': {
        type: 'command',
        parseComments: true,
        parseSubstitutions: true,
        parseQuoted: true,
        terminator: RegExp('@\\]'),
        terminateMethod: 'terminateGetString',
        balance: RegExp('[{\'"]'),
        allowStar: true,
        allowDblStar: true,
        allowTriStar: true
    },
    '[$': {
        type: 'variable',
        parseComments: true,
        parseSubstitutions: false,
        terminator: RegExp('\\$?\\]'),
        terminateMethod: 'terminateGetString',
        balance: balanceAll,
        cancelUnbalanced: true,
        cancelNL: true,
        allowStar: true,
        allowDblStar: true,
        allowTriStar: true
    },
    ' [|': { type: 'verbatim', cancelNL: true, allowStar: true, terminateMethod: 'terminateGetString' },
    ' {': {
        type: 'options',
        parseComments: true,
        parseSubstitutions: false,
        terminator: RegExp('\\}'),
        balance: balanceAll,
        cancelUnbalanced: true,
        terminateMethod: 'terminateOptions'
    },
    '{': {
        type: 'balance',
        parseComments: true,
        parseSubstitutions: true,
        terminator: RegExp('\\}'),
        balance: balanceAll,
        cancelUnbalanced: true
    },
    '[': {
        type: 'balance',
        parseComments: true,
        parseSubstitutions: true,
        terminator: RegExp('\\]'),
        balance: balanceAll,
        cancelUnbalanced: true
    },
    "'": { type: 'balance', terminator: RegExp("'"), terminateMethod: 'terminateBalance' },
    '"': { type: 'balance', terminator: RegExp('\\"'), terminateMethod: 'terminateBalance' },
    '```': { type: 'code', terminator: RegExp('```'), terminateMethod: 'terminateCode', allowPar: true },
    ':   ': {
        type: 'pre',
        parseAll: true,
        terminator: RegExp('\\n+'),
        terminateMethod: 'terminatePre',
        noIndent: -1
    },
    '>>': {
        type: 'align',
        parseAll: true,
        align: 'right',
        noIndent: -1
    },
    '#': { type: 'heading', parseAll: true },
    '*': { type: 'bold', parseAll: true, cancelPar: true },
    _: { type: 'italic', parseAll: true, cancelPar: true },
    bullet: { type: 'bullet', parseAll: true },
    list: { type: 'list', parseAll: true, combine: { list: 'bullet', par: true }, noIndent: -1 }
};

export const PGMLShow = (input: string) => {
    warnings.length = 0;
    const parser = new Parse(input);
    if (warnings.length) console.warn('Errors parsing PGML:\n' + warnings.join('\n'));
    return parser.root?.show() ?? '';
};
