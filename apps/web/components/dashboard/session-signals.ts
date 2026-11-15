// Shared by the server page and the client table. No "use client" here, on purpose.

export interface SessionRow {
  attemptId: string;
  answers: number;
  keys: number;
  clicks: number;
  clickNoMoveRatio: number | null;
  answerNoInputRatio: number | null;
  answersInDeadRange: number;
  keyCv: number | null;
  secondsAway: number;
  webdriver: boolean | null;
  /** Behaviours that differ from a person at the keyboard. Evidence, never a verdict. */
  signals: string[];
}

/** Behaviour rules that surface evidence for the professor. The trained model replaces the ordering, not the evidence. */
export function sessionSignals(r: Omit<SessionRow, "signals">): string[] {
  const s: string[] = [];
  if (r.clicks >= 2 && (r.clickNoMoveRatio ?? 0) >= 0.8) s.push("Clicks with no mouse movement before them");
  if (r.answers >= 1 && (r.answerNoInputRatio ?? 0) >= 0.5) s.push("Answers set without typing or clicking on the question");
  if (r.answersInDeadRange >= 2) s.push("Answers changed during long input silences");
  if (r.webdriver) s.push("Browser reported automation (weak signal)");
  return s;
}

