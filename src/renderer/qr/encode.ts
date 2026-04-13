/**
 * QR Code Version-1 (21×21) encoder.
 * Supports: Byte mode, Error correction levels L/M/Q/H.
 * Returns a 21×21 boolean matrix (true = dark module).
 */
import { gfPoly, gfPolyRemainder } from './gf';

// EC codewords per level for Version 1
const EC_CODEWORDS: Record<string, number> = { L: 7, M: 10, Q: 13, H: 17 };
// Data codewords per level for Version 1
const DATA_CODEWORDS: Record<string, number> = { L: 19, M: 16, Q: 13, H: 9 };
// Format info strings (mask 0, levels L/M/Q/H) — pre-computed 15-bit patterns
const FORMAT_INFO: Record<string, number> = {
  L: 0x77c4, M: 0x72f3, Q: 0x7daa, H: 0x789d,
};
const MASK0 = (r: number, c: number) => (r + c) % 2 === 0;

export function encodeQR(text: string, ecLevel: 'L' | 'M' | 'Q' | 'H' = 'M'): boolean[][] {
  const size = 21;
  const mat: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  placeFinderPatterns(mat, reserved);
  placeTimingPatterns(mat, reserved);
  placeAlignmentPattern(mat, reserved);  // Version 1 has no alignment pattern, no-op
  reserveFormatArea(reserved);

  const dataBytes = buildDataCodewords(text, ecLevel);
  const ecBytes   = buildECCodewords(dataBytes, ecLevel);
  const allBytes: number[]  = [...dataBytes, ...ecBytes];

  placeDataBits(mat, reserved, allBytes);
  applyMask0(mat, reserved);
  placeFormatInfo(mat, ecLevel);

  return mat;
}

function placeFinderPatterns(mat: boolean[][], res: boolean[][]): void {
  const corners = [[0, 0], [0, 14], [14, 0]] as const;
  for (const [r, c] of corners) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= 21 || cc < 0 || cc >= 21) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        const onRing  = (dr === 0 || dr === 6 || dc === 0 || dc === 6);
        mat[rr][cc] = inInner || (inOuter && onRing);
        res[rr][cc] = true;
      }
    }
  }
}

function placeTimingPatterns(mat: boolean[][], res: boolean[][]): void {
  for (let i = 8; i <= 12; i++) {
    mat[6][i] = i % 2 === 0; res[6][i] = true;
    mat[i][6] = i % 2 === 0; res[i][6] = true;
  }
}

function placeAlignmentPattern(_mat: boolean[][], _res: boolean[][]): void {
  // Version 1: no alignment pattern
}

function reserveFormatArea(res: boolean[][]): void {
  for (let i = 0; i <= 8; i++) { res[8][i] = true; res[i][8] = true; }
  for (let i = 13; i <= 20; i++) { res[8][i] = true; res[i][8] = true; }
  res[13][8] = true; // dark module
}

function buildDataCodewords(text: string, ecLevel: string): Uint8Array {
  const capacity = DATA_CODEWORDS[ecLevel];
  const encoder  = new TextEncoder();
  const bytes    = encoder.encode(text);

  const bits: number[] = [];
  // Mode indicator: Byte = 0100
  bits.push(0, 1, 0, 0);
  // Character count: 8 bits for Version 1 byte mode
  const len = Math.min(bytes.length, capacity - 2); // approximate
  for (let i = 7; i >= 0; i--) bits.push((len >> i) & 1);
  // Data bytes
  for (let k = 0; k < len; k++) {
    for (let i = 7; i >= 0; i--) bits.push((bytes[k] >> i) & 1);
  }
  // Terminator (up to 4 zero bits)
  const maxBits = capacity * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);
  // Pad codewords
  const PAD = [0xec, 0x11];
  let pi = 0;
  while (bits.length < maxBits) {
    const p = PAD[pi++ % 2];
    for (let i = 7; i >= 0; i--) bits.push((p >> i) & 1);
  }

  const out = new Uint8Array(capacity);
  for (let i = 0; i < capacity; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i * 8 + j] ?? 0);
    out[i] = b;
  }
  return out;
}

function buildECCodewords(data: Uint8Array, ecLevel: string): number[] {
  const ecCount = EC_CODEWORDS[ecLevel];
  const gen     = gfPoly(ecCount);
  return gfPolyRemainder(data, gen);
}

function placeDataBits(mat: boolean[][], res: boolean[][], bytes: number[]): void {
  const bits: boolean[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) bits.push(((byte >> i) & 1) === 1);
  }

  let idx = 0;
  let goUp = true;
  for (let col = 20; col >= 0; col -= 2) {
    if (col === 6) col--; // skip timing column
    for (let row = goUp ? 20 : 0; goUp ? row >= 0 : row <= 20; goUp ? row-- : row++) {
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!res[row][c] && idx < bits.length) {
          mat[row][c] = bits[idx++];
        }
      }
    }
    goUp = !goUp;
  }
}

function applyMask0(mat: boolean[][], res: boolean[][]): void {
  for (let r = 0; r < 21; r++) {
    for (let c = 0; c < 21; c++) {
      if (!res[r][c] && MASK0(r, c)) mat[r][c] = !mat[r][c];
    }
  }
}

function placeFormatInfo(mat: boolean[][], ecLevel: 'L' | 'M' | 'Q' | 'H'): void {
  const info = FORMAT_INFO[ecLevel];
  const bits = Array.from({ length: 15 }, (_, i) => (info >> (14 - i)) & 1);

  const hPos = [0,1,2,3,4,5,7,8,8,8,8,8,8,8,8];
  const vPos = [8,8,8,8,8,8,8,8,7,5,4,3,2,1,0];
  for (let i = 0; i < 15; i++) {
    mat[8][hPos[i]]         = bits[i] === 1;
    mat[20 - vPos[i]][8]    = bits[i] === 1;
  }
  mat[13][8] = true; // mandatory dark module
}
