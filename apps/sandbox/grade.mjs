// Server-side grading for sandbox items (shape: packages/shared Item).

/** Parse "1/6", "0.1667", "16.67%", " 2 " into a number, or NaN. */
export function parseNumber(raw) {
  if (raw === null || raw === undefined) return NaN;
  const s = String(raw).trim().replace(/,/g, "");
  if (s === "") return NaN;
  let m;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/))) return Number(m[1]) / Number(m[2]);
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/))) return Number(m[1]) / 100;
  if (/^-?\d+(?:\.\d+)?(?:e-?\d+)?$/i.test(s)) return Number(s);
  return NaN;
}

const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");

export function gradeItem(item, answer) {
  if (answer === null || answer === undefined) return false;
  switch (item.type) {
    case "mcq":
      return !Array.isArray(answer) && answer === item.answerKey;
    case "multi": {
      const got = new Set([].concat(answer));
      const want = new Set([].concat(item.answerKey));
      return got.size === want.size && [...want].every((x) => got.has(x));
    }
    case "numeric": {
      const got = parseNumber(answer);
      const want = parseNumber(item.answerKey);
      if (Number.isNaN(got) || Number.isNaN(want)) return false;
      // Accept rounding to 3 significant decimals (0.167 for 1/6), reject 0.17.
      return Math.abs(got - want) <= Math.max(5e-4, Math.abs(want) * 1e-3);
    }
    case "short":
      return [].concat(item.answerKey).some((k) => norm(k) === norm(answer));
    default:
      return false;
  }
}
