/**
 * This is copied from https://github.com/Sherryer/dct2, which is distributed under an MIT license
 *
 * It has been modified to memoize calls to Math.cos()
 */

const Hash = {};
const Cosines = {};

const cosine = (first, second, len) => {
    if (!Cosines[len]) {
        Cosines[len] = {};
    }

    if (!Cosines[len][first]) {
        Cosines[len][first] = {};
    }

    if (!Cosines[len][first][second]) {
        Cosines[len][first][second] = Math.cos((2 * first + 1) * Math.PI * second / 2 / len)
    }

    return Cosines[len][first][second];
}

const getCoff = (index, length) => {
    if (!Hash[length]) {
        let coff = [];
        coff[0] = 1 / Math.sqrt(length);
        for (let i = 1; i < length; i++){
            coff[i] = Math.sqrt(2) / Math.sqrt(length);
        }
        Hash[length] = coff;
    }
    return Hash[length][index];
};

const DCT = (signal) => {
    const length = signal.length;
    let tmp = Array(length * length).fill(0);
    let res = Array(length).fill('').map(() => []);
    for (let i = 0; i < length; i++){
        for (let j = 0; j < length; j++){
            for (let x = 0; x < length; x++){
                tmp[i * length + j] += getCoff(j, length) * signal[i][x] * cosine(x, j, length);
            }
        }
    }
    for (let i = 0; i < length; i++){
        for (let j = 0; j < length; j++){
            for (let x = 0; x < length; x++){
                res[i][j] = (res[i][j] || 0) + getCoff(i, length) * tmp[x * length + j] * cosine(x, i, length)
            }
        }
    }
    return res
};

const IDCT = (signal) => {
    const length = signal.length;
    let tmp = Array(length * length).fill(0);
    let res = Array(length).fill('').map(() => []);
    for (let i = 0; i < length; i++){
        for (let j = 0; j < length; j++){
            for (let x = 0; x < length; x++){
                tmp[i*length + j] += getCoff(x, length) * signal[i][x] * cosine(j, x, length);
            }
        }
    }
    for (let i = 0; i < length; i++){
        for (let j = 0; j < length; j++){
            for (let x = 0; x < length; x++){
                res[i][j] = (res[i][j] || 0) + getCoff(x, length) * tmp[x*length + j] * cosine(i, x, length)
            }
        }
    }
    return res;
};

// End copied code

const diagonalSnake = (matrix, rows, cols) => {
    const result = new Array(rows * cols);
    let resultIdx = 0;
    for (let line = 1; line <= (rows + cols - 1); line++) {
        let start_col = Math.max(0, line - rows);
        let count = Math.min(line, (cols - start_col), rows);
        for (let j = 0; j < count; j++) {
            result[resultIdx] = matrix[Math.min(rows, line) - j - 1][start_col + j];
            resultIdx++;
        }
    }

    return result
}

exports.DCT = DCT;
exports.IDCT = IDCT;
exports.diagonalSnake = diagonalSnake
