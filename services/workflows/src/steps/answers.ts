import type { ItemType } from "@unprompted/shared";

/** Canonical text form of an answer key, for comparing solver output to the generator's key. */
export function answerText(key: string | string[]): string {
  return Array.isArray(key) ? [...key].map(norm).sort().join(",") : norm(key);
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/^\(?([a-z])\)$/, "$1").replace(/\s+/g, " ");
}

/** Parse "1/6", "0.1667", "16.7%", "2" into a number; null if not numeric. */
export function parseNumber(s: string): number | null {
  const t = s.trim().replace(/,/g, "");
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? null : Number(frac[1]) / d;
  }
  const pct = t.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pct) return Number(pct[1]) / 100;
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : null;
}

/** Do two answers agree for this item type? Numeric answers use a relative tolerance. */
export function sameAnswer(type: ItemType, a: string, b: string, relTol = 1e-3): boolean {
  if (type === "numeric") {
    const x = parseNumber(a);
    const y = parseNumber(b);
    if (x == null || y == null) return norm(a) === norm(b);
    return Math.abs(x - y) <= relTol * Math.max(1, Math.abs(x), Math.abs(y));
  }
  if (type === "multi") return answerText(a.split(/[,\s]+/).filter(Boolean)) === answerText(b.split(/[,\s]+/).filter(Boolean));
  return norm(a) === norm(b);
}

/** Pull the last `FINAL: ...` line out of a model response. */
export function extractFinal(text: string): string | null {
  const m = [...text.matchAll(/^\s*\**FINAL\**\s*[:=]\s*\**\s*(.+?)\s*$/gim)];
  return m.length ? m[m.length - 1]![1]!.replace(/^`+|`+$/g, "").replace(/\*+$/, "").trim() : null;
}
