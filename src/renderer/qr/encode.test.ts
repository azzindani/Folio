import { describe, it, expect } from 'vitest';
import { encodeQR } from './encode';

describe('encodeQR', () => {
  it('returns a 21×21 boolean matrix', () => {
    const mat = encodeQR('A');
    expect(mat).toHaveLength(21);
    for (const row of mat) {
      expect(row).toHaveLength(21);
      for (const cell of row) {
        expect(typeof cell).toBe('boolean');
      }
    }
  });

  it('top-left finder pattern: 7×7 block present', () => {
    const mat = encodeQR('test');
    // Corner module of finder pattern must be dark
    expect(mat[0][0]).toBe(true);
    expect(mat[0][6]).toBe(true);
    expect(mat[6][0]).toBe(true);
    expect(mat[6][6]).toBe(true);
    // Center of finder pattern (inner solid block)
    expect(mat[2][2]).toBe(true);
    expect(mat[4][4]).toBe(true);
  });

  it('top-right finder pattern corner modules are dark', () => {
    const mat = encodeQR('hi');
    expect(mat[0][14]).toBe(true);
    expect(mat[0][20]).toBe(true);
    expect(mat[6][14]).toBe(true);
    expect(mat[6][20]).toBe(true);
  });

  it('bottom-left finder pattern corner modules are dark', () => {
    const mat = encodeQR('hi');
    expect(mat[14][0]).toBe(true);
    expect(mat[14][6]).toBe(true);
    expect(mat[20][0]).toBe(true);
    expect(mat[20][6]).toBe(true);
  });

  it('timing pattern row 6: alternates starting dark at column 8', () => {
    const mat = encodeQR('x');
    expect(mat[6][8]).toBe(true);   // even index → dark
    expect(mat[6][9]).toBe(false);  // odd → light
    expect(mat[6][10]).toBe(true);
    expect(mat[6][11]).toBe(false);
    expect(mat[6][12]).toBe(true);
  });

  it('timing pattern col 6: alternates starting dark at row 8', () => {
    const mat = encodeQR('x');
    expect(mat[8][6]).toBe(true);
    expect(mat[9][6]).toBe(false);
    expect(mat[10][6]).toBe(true);
    expect(mat[11][6]).toBe(false);
    expect(mat[12][6]).toBe(true);
  });

  it('mandatory dark module at (13, 8)', () => {
    const mat = encodeQR('hello');
    expect(mat[13][8]).toBe(true);
  });

  it('produces consistent output for same input', () => {
    const a = encodeQR('hello world');
    const b = encodeQR('hello world');
    expect(a).toEqual(b);
  });

  it('produces different output for different inputs', () => {
    const a = encodeQR('AAA');
    const b = encodeQR('BBB');
    // At least one module must differ
    let differs = false;
    for (let r = 0; r < 21 && !differs; r++) {
      for (let c = 0; c < 21 && !differs; c++) {
        if (a[r][c] !== b[r][c]) differs = true;
      }
    }
    expect(differs).toBe(true);
  });

  it('encodes with EC level L', () => {
    const mat = encodeQR('test', 'L');
    expect(mat).toHaveLength(21);
    expect(mat[13][8]).toBe(true); // dark module always present
  });

  it('encodes with EC level Q', () => {
    const mat = encodeQR('hi', 'Q');
    expect(mat).toHaveLength(21);
  });

  it('encodes with EC level H', () => {
    const mat = encodeQR('hi', 'H');
    expect(mat).toHaveLength(21);
  });

  it('handles empty string', () => {
    const mat = encodeQR('');
    expect(mat).toHaveLength(21);
    expect(mat[13][8]).toBe(true);
  });

  it('handles single character', () => {
    const mat = encodeQR('Z');
    expect(mat).toHaveLength(21);
  });

  it('handles max-capacity string for level M (16 data codewords ~ 14 chars)', () => {
    const mat = encodeQR('Hello, World!!');
    expect(mat).toHaveLength(21);
  });
});
