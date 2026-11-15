"use client";
// One quiz item. Plain, stable DOM on purpose: native inputs, real <label>s and fixed ids,
// so screen readers and the red-team browser agents (workstream A) see the same structure.
import type { Answer, PublicItem } from "./types";

export function ItemView({
  item,
  value,
  onChange,
  disabled,
  hideStem,
}: {
  hideStem?: boolean; // the stem is shown by the surrounding card; keep it for screen readers
  item: PublicItem;
  value: Answer;
  onChange: (v: Answer) => void;
  disabled?: boolean;
}) {
  const stemId = `stem-${item.id}`;
  return (
    <fieldset id={`item-${item.id}`} data-item-id={item.id} data-item-type={item.type} aria-labelledby={stemId} className="space-y-4" disabled={disabled}>
      <legend id={stemId} className={hideStem ? "sr-only" : "text-lg font-medium leading-snug"}>
        {item.stem}
      </legend>

      {item.type === "mcq" && (
        <div role="radiogroup" aria-labelledby={stemId} className="space-y-2">
          {item.choices?.map((c) => (
            <label key={c.id} htmlFor={`choice-${c.id}`} className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 has-[:checked]:border-primary">
              <input
                type="radio"
                id={`choice-${c.id}`}
                name="answer"
                value={c.id}
                checked={value === c.id}
                onChange={() => onChange(c.id)}
              />
              <span>
                <span className="font-mono text-muted-foreground">{c.id})</span> {c.text}
              </span>
            </label>
          ))}
        </div>
      )}

      {item.type === "multi" && (
        <div className="space-y-2">
          {item.choices?.map((c) => {
            const arr = Array.isArray(value) ? value : [];
            return (
              <label key={c.id} htmlFor={`choice-${c.id}`} className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 has-[:checked]:border-primary">
                <input
                  type="checkbox"
                  id={`choice-${c.id}`}
                  name="answer"
                  value={c.id}
                  checked={arr.includes(c.id)}
                  onChange={(e) => onChange(e.target.checked ? [...arr, c.id] : arr.filter((x) => x !== c.id))}
                />
                <span>
                  <span className="font-mono text-muted-foreground">{c.id})</span> {c.text}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {(item.type === "numeric" || item.type === "short") && (
        <div className="space-y-1">
          <label htmlFor="answer-input" className="text-sm text-muted-foreground">
            Your answer
          </label>
          <input
            id="answer-input"
            name="answer"
            type="text"
            inputMode={item.type === "numeric" ? "decimal" : "text"}
            autoComplete="off"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="block w-full max-w-xs rounded-md border bg-transparent px-3 py-2"
          />
        </div>
      )}
    </fieldset>
  );
}
