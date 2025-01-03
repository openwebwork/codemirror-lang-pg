// Note that 'eval' and 'do' are not in this list as they can accept a block.
export const namedUnaryOperators = new Set([
    'chr',
    'defined',
    'delete',
    'evalbytes',
    'exists',
    'exp',
    'gethostbyname',
    'getnetbyname',
    'getpgrp',
    'gmtime',
    'hex',
    'int',
    'lc',
    'lcfirst',
    'length',
    'localtime',
    'lock',
    'oct',
    'ord',
    'pos',
    'quotemeta',
    'ref',
    'scalar',
    'select',
    'uc',
    'ucfirst',
    'undef',
    'untie'
]);

// The list operators that can operate on a block (grep, map, join, sort, and unpack) are handled separately.
export const listOperators = new Set([
    'chomp',
    'chop',
    'crypt',
    'die',
    'getpriority',
    'index',
    'pack',
    'pipe',
    'reverse',
    'rindex',
    'setpgrp',
    'setpriority',
    'split',
    'sprintf',
    'substr',
    'tie',
    'vec',
    'warn'
]);
