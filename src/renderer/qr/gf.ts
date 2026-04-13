/**
 * Galois Field GF(256) arithmetic for QR Reed-Solomon.
 * Generator polynomial: x^8 + x^4 + x^3 + x^2 + 1  (0x11d)
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

export function gfPow(x: number, power: number): number {
  return EXP[(LOG[x] * power) % 255];
}

export function gfPoly(degree: number): number[] {
  // Generate RS generator polynomial for `degree` error correction codewords
  let poly: number[] = [1];
  for (let i = 0; i < degree; i++) {
    poly = gfPolyMul(poly, [1, gfPow(2, i)]);
  }
  return poly;
}

function gfPolyMul(p: number[], q: number[]): number[] {
  const result = new Array<number>(p.length + q.length - 1).fill(0);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      result[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return result;
}

export function gfPolyRemainder(msg: Uint8Array, gen: number[]): number[] {
  const out: number[] = [...msg, ...new Array<number>(gen.length - 1).fill(0)];
  for (let i = 0; i < msg.length; i++) {
    const coef = out[i];
    if (coef === 0) continue;
    for (let j = 1; j < gen.length; j++) {
      out[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return out.slice(msg.length);
}
