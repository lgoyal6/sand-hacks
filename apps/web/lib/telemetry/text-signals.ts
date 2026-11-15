"use client";
// Typed-input signals for one textarea (the think-aloud explanation and follow-up answer).
// Evidence for a professor's follow-up conversation, never a verdict. The telling pattern for a
// scripted fill is a long final text with few or no real keystrokes (value set programmatically).
// We never store what was typed here (the text itself goes to the probe), only timing and counts.

export interface TextSignals {
  keys: number;
  keyIntervalMedianMs: number | null;
  keyIntervalIqrMs: number | null;
  pastes: number;
  pastedChars: number;
  inputEvents: number;
  /** Value changes not preceded by a keystroke or paste (e.g. set via script or dictation). */
  nonKeyInputEvents: number;
  charsTyped: number;
  finalLength: number;
  activeMs: number;
  firstKeyAfterMs: number | null;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};

/** Attach to a textarea; returns a reader for the signals so far. Call reset() when the field is reused. */
export function trackTextSignals(el: HTMLTextAreaElement) {
  const shownAt = performance.now();
  let lastKey: number | null = null;
  let firstKey: number | null = null;
  let lastActivity = shownAt;
  let sawKeyOrPaste = false;
  const gaps: number[] = [];
  const s = { keys: 0, pastes: 0, pastedChars: 0, inputEvents: 0, nonKeyInputEvents: 0, charsTyped: 0 };

  let composing = false;
  const onKey = () => {
    const now = performance.now();
    s.keys++;
    if (lastKey !== null) gaps.push(now - lastKey);
    lastKey = now;
    firstKey ??= now;
    lastActivity = now;
    sawKeyOrPaste = true;
  };
  const onPaste = (e: ClipboardEvent) => {
    s.pastes++;
    s.pastedChars += e.clipboardData?.getData("text")?.length ?? 0;
    lastActivity = performance.now();
    sawKeyOrPaste = true;
  };
  // Characters come from the inserted text, not from e.key: Android keyboards report "Unidentified" and IME
  // composition reports "Process", so counting e.key would mislabel hand typing as "without keystrokes".
  const onInput = (ev: Event) => {
    const e = ev as InputEvent;
    s.inputEvents++;
    const typedHere = sawKeyOrPaste || composing;
    if (!typedHere) s.nonKeyInputEvents++;
    else if (e.inputType === "insertText" || e.inputType === "insertCompositionText" || e.inputType === "insertReplacementText") s.charsTyped += e.data?.length ?? 0;
    else if (e.inputType === "insertLineBreak") s.charsTyped += 1;
    sawKeyOrPaste = false;
    lastActivity = performance.now();
  };
  el.addEventListener("keydown", onKey);
  el.addEventListener("paste", onPaste);
  el.addEventListener("input", onInput);
  const onCompStart = () => (composing = true);
  const onCompEnd = () => (composing = false);
  el.addEventListener("compositionstart", onCompStart);
  el.addEventListener("compositionend", onCompEnd);

  return {
    read(): TextSignals {
      const q1 = quantile(gaps, 0.25);
      const q3 = quantile(gaps, 0.75);
      return {
        ...s,
        keyIntervalMedianMs: quantile(gaps, 0.5) === null ? null : Math.round(quantile(gaps, 0.5)!),
        keyIntervalIqrMs: q1 === null || q3 === null ? null : Math.round(q3 - q1),
        finalLength: el.value.length,
        activeMs: Math.round(lastActivity - shownAt),
        firstKeyAfterMs: firstKey === null ? null : Math.round(firstKey - shownAt),
      };
    },
    stop() {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("paste", onPaste);
      el.removeEventListener("input", onInput);
      el.removeEventListener("compositionstart", onCompStart);
      el.removeEventListener("compositionend", onCompEnd);
    },
  };
}
