/**
 * Stable 32-bit hash for assignment. The repo has no shared exported hash helper (insights/variant.ts keeps its
 * sha256 bucket private), so this is a small FNV-1a with a murmur3 finaliser to spread the low bits.
 * Pure and dependency-free, so the same input gives the same number in any runtime.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a over the UTF-16 code units of the input, returned as an unsigned 32-bit integer. */
export function fnv1a32(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** murmur3 fmix32: mixes every input bit into every output bit. */
function fmix32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * Position of a subject inside one experiment, as a percentage in [0, 100). The experiment key is part of the
 * input, so two experiments split the same subjects independently. The separator is a NUL character, which cannot
 * appear in a sensible id, so ("ab", "c") and ("a", "bc") never collide.
 */
export function bucketPercent(experimentKey: string, subjectId: string): number {
  const h = fmix32(fnv1a32(`${experimentKey}\u0000${subjectId}`));
  return (h / 2 ** 32) * 100;
}
