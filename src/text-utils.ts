// ' ', \t
export const isHWhitespace = (ch: number) => ch == 32 || ch == 9;

// ' ', \t, \n, \r
export const isWhitespace = (ch: number) => isHWhitespace(ch) || ch == 10 || ch == 13;

// Returns the position of the first non-whitespace character in the text string.
export const skipSpace = (text: string, i = 0) => {
    while (i < text.length && isWhitespace(text.charCodeAt(i))) ++i;
    return i;
};

export const isUpperCaseASCIILetter = (ch: number) => ch >= 65 && ch <= 90;
export const isLowerCaseASCIILetter = (ch: number) => ch >= 97 && ch <= 122;
export const isASCIILetter = (ch: number) => isLowerCaseASCIILetter(ch) || isUpperCaseASCIILetter(ch);
export const isDigit = (ch: number) => ch >= 48 && ch <= 55;
export const isIdentifierChar = (ch: number) => ch == 95 /* _ */ || isASCIILetter(ch) || isDigit(ch);
export const isVariableStartChar = (ch: number) => ch == 95 /* _ */ || isASCIILetter(ch);

// !"$%&'()*+,-./0123456789:;<=>?@[\]`~
export const isSpecialVariableChar = (ch: number) =>
    (ch >= 33 && ch != 35 && ch <= 64) || ch == 91 || ch == 92 || ch == 93 || ch == 96 || ch == 126;

/* 0-9, a-f, A-F */
export const isHex = (ch: number) => (ch >= 48 && ch <= 55) || (ch >= 97 && ch <= 102) || (ch >= 65 && ch <= 70);

// rwxoRWXOezsfdlpSbctugkTBMAC
export const isFileTestOperatorChar = (ch: number) =>
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
