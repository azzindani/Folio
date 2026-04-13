import { describe, it, expect } from 'vitest';
import { gfMul, gfPow, gfPoly, gfPolyRemainder } from './gf';

describe('gfMul', () => {
  it('returns 0 when either operand is 0', () => {
    expect(gfMul(0, 5)).toBe(0);
    expect(gfMul(5, 0)).toBe(0);
    expect(gfMul(0, 0)).toBe(0);
  });

  it('identity: gfMul(x, 1) === x', () => {
    expect(gfMul(1, 1)).toBe(1);
    expect(gfMul(42, 1)).toBe(42);
    expect(gfMul(255, 1)).toBe(255);
  });

  it('is commutative', () => {
    expect(gfMul(3, 7)).toBe(gfMul(7, 3));
    expect(gfMul(100, 200)).toBe(gfMul(200, 100));
  });

  it('known result: gfMul(2, 3) === 6 in GF(256)', () => {
    // 2 * 3 = 6 (no carry in low bits)
    expect(gfMul(2, 3)).toBe(6);
  });

  it('handles reduction for high values', () => {
    // 0x80 * 2 should trigger reduction
    const result = gfMul(0x80, 2);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(256);
  });
});

describe('gfPow', () => {
  it('gfPow(x, 0) === 1', () => {
    expect(gfPow(2, 0)).toBe(1);
    expect(gfPow(255, 0)).toBe(1);
  });

  it('gfPow(2, 1) === 2', () => {
    expect(gfPow(2, 1)).toBe(2);
  });

  it('gfPow(2, 8) is a field element < 256', () => {
    const r = gfPow(2, 8);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(256);
  });

  it('is consistent with gfMul for power 2', () => {
    const via_pow = gfPow(3, 2);
    const via_mul = gfMul(3, 3);
    expect(via_pow).toBe(via_mul);
  });
});

describe('gfPoly', () => {
  it('degree 7 (EC level L): returns array of length 8', () => {
    const p = gfPoly(7);
    expect(p).toHaveLength(8);
  });

  it('degree 10 (EC level M): returns array of length 11', () => {
    const p = gfPoly(10);
    expect(p).toHaveLength(11);
  });

  it('leading coefficient is always 1', () => {
    expect(gfPoly(7)[0]).toBe(1);
    expect(gfPoly(10)[0]).toBe(1);
    expect(gfPoly(13)[0]).toBe(1);
  });

  it('all coefficients are valid field elements', () => {
    const p = gfPoly(10);
    for (const c of p) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(256);
    }
  });
});

describe('gfPolyRemainder', () => {
  it('returns an array of length gen.length - 1', () => {
    const gen = gfPoly(7);
    const msg = new Uint8Array([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17, 236, 17, 236]);
    const rem = gfPolyRemainder(msg, gen);
    expect(rem).toHaveLength(gen.length - 1);
  });

  it('all remainder bytes are valid field elements', () => {
    const gen = gfPoly(10);
    const msg = new Uint8Array([64, 20, 134, 86, 198, 198, 242, 194, 236, 17, 236, 17, 236, 17, 236, 17]);
    const rem = gfPolyRemainder(msg, gen);
    for (const b of rem) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(256);
    }
  });

  it('empty message body returns zeroed remainder', () => {
    const gen = gfPoly(7);
    const msg = new Uint8Array(19).fill(0);
    const rem = gfPolyRemainder(msg, gen);
    expect(rem).toHaveLength(7);
    // All zeros input → all zeros output (0 * anything = 0 in GF)
    expect(rem.every(b => b === 0)).toBe(true);
  });
});
