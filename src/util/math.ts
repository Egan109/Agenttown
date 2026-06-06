export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Clamp to the 0..100 range used by traits, skills, needs, emotions. */
export function clamp100(v: number): number {
  return clamp(v, 0, 100);
}

/** Clamp to the -100..100 range used by trust / affection. */
export function clampSigned(v: number): number {
  return clamp(v, -100, 100);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function manhattan(
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function chebyshev(
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  let s = 0;
  for (const n of nums) s += n;
  return s / nums.length;
}

export function sum(nums: number[]): number {
  let s = 0;
  for (const n of nums) s += n;
  return s;
}

/** Gini coefficient (0 = perfect equality, 1 = maximal inequality). */
export function gini(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let cum = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    cum += sorted[i];
    weighted += (i + 1) * sorted[i];
  }
  if (cum === 0) return 0;
  return (2 * weighted) / (n * cum) - (n + 1) / n;
}

export function uid(prefix: string, n: number): string {
  return `${prefix}_${n.toString(36)}`;
}
