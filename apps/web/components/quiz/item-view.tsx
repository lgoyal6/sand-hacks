"use client";
// One quiz item. Real native inputs with real labels and fixed ids (D's ChoiceOption keeps the native
// input), so screen readers and the red-team browser agents (workstream A) see the same structure.
// `locked` renders an answered item for the thread history: no ids or names, so the active item's
// ids (#choice-a, #answer-input, ...) stay unique on the page.
import { AnswerInput, ChoiceList, ChoiceOption } from "@/components/ui/chat";
import type { Answer, PublicItem } from "./types";

const LETTERS = "ABCDEFGH";

export interface ItemResult {
  correct: boolean;
  /** Correct choice ids, when the server shares them (practice mode). */
  correctIds?: string[];
}

export function ItemView({
  item,
  value,
  onChange,
  disabled,
  hideStem,
  locked,
  result,
}: {
  item: PublicItem;
  value: Answer;
  onChange?: (v: Answer) => void;
  disabled?: boolean;
  hideStem?: boolean; // the stem is shown by the surrounding card; keep it for screen readers
  locked?: boolean;
  result?: ItemResult;
}) {
  const ids = !locked;
  const stemId = ids ? `stem-${item.id}` : undefined;
  const chosen = Array.isArray(value) ? value : value ? [value] : [];
  const stateFor = (choiceId: string): "correct" | "incorrect" | undefined => {
    if (!result) return undefined;
    if (result.correctIds?.includes(choiceId)) return "correct";
    if (chosen.includes(choiceId)) return result.correct ? "correct" : "incorrect";
    return undefined;
  };
  const off = disabled || locked;

  return (
    <fieldset
      id={ids ? `item-${item.id}` : undefined}
      data-item-id={ids ? item.id : undefined}
      data-item-type={ids ? item.type : undefined}
      aria-labelledby={stemId}
      className="space-y-4"
      disabled={off}
    >
      <legend id={stemId} className={hideStem ? "sr-only" : "text-lg font-medium leading-snug"}>
        {item.stem}
      </legend>

      {(item.type === "mcq" || item.type === "multi") && (
        <ChoiceList>
          {item.choices?.map((c, i) => (
            <ChoiceOption
              key={c.id}
              id={ids ? `choice-${c.id}` : undefined}
              name={ids ? "answer" : undefined}
              value={c.id}
              kind={item.type === "multi" ? "checkbox" : "radio"}
              letter={LETTERS[i] ?? c.id.toUpperCase()}
              checked={chosen.includes(c.id)}
              disabled={off}
              state={stateFor(c.id)}
              onChange={(e) => {
                if (!onChange || locked) return;
                if (item.type === "multi") onChange(e.target.checked ? [...chosen, c.id] : chosen.filter((x) => x !== c.id));
                else onChange(c.id);
              }}
            >
              {c.text}
            </ChoiceOption>
          ))}
        </ChoiceList>
      )}

      {(item.type === "numeric" || item.type === "short") && (
        <div className="space-y-1.5">
          <label htmlFor={ids ? "answer-input" : undefined} className="text-sm text-muted-foreground">
            Your answer
          </label>
          <AnswerInput
            id={ids ? "answer-input" : undefined}
            name={ids ? "answer" : undefined}
            type="text"
            inputMode={item.type === "numeric" ? "decimal" : "text"}
            autoComplete="off"
            value={typeof value === "string" ? value : ""}
            disabled={off}
            aria-invalid={result ? !result.correct : undefined}
            onChange={(e) => onChange?.(e.target.value)}
          />
        </div>
      )}
    </fieldset>
  );
}
