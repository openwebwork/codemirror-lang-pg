export const toLineContext = (file: string, index: number) => {
    const endEol = file.indexOf('\n', index + 80);
    const endIndex = endEol === -1 ? file.length : endEol;
    return file
        .substring(index, endIndex)
        .split(/\n/)
        .map((str) => '  | ' + str)
        .join('\n');
};
