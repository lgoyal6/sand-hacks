"use client";
// A quiz question rendered inline in the thread: stem, full-width rounded options (or a numeric/short input),
// and a quiet submit. After grading, options show correct/incorrect without shouting.
import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QuestionChoice {
  id: string;
  text: string;
}

export interface QuestionCardProps {
  /** e.g. "Question 2 of 5". */
  label?: string;
  stem: string;
  type?: "mcq" | "multi" | "numeric" | "short";
  choices?: QuestionChoice[];
  /** Controlled value: choice id(s) or text. */
  value?: string | string[];
  onChange?: (value: string | string[]) => void;
  onSubmit?: (value: string | string[]) => void;
  /** After grading: which choice ids are correct, and whether the answer was right. */
  result?: { correct: boolean; correctIds?: string[] };
  disabled?: boolean;
  submitLabel?: string;
  /** Custom body (e.g. C's ItemView with stable ids). Replaces the built-in choices/input when given. */
  children?: React.ReactNode;
  /** Custom footer (e.g. #submit-answer / #next-item). Replaces the built-in submit button when given. */
  footer?: React.ReactNode;
  className?: string;
}

const LETTERS = "ABCDEFGH";

export function QuestionCard({
  label,
  stem,
  type = "mcq",
  choices = [],
  value: valueProp,
  onChange,
  onSubmit,
  result,
  disabled,
  submitLabel = "Submit",
  children,
  footer,
  className,
}: QuestionCardProps) {
  const [inner, setInner] = React.useState<string | string[]>(type === "multi" ? [] : "");
  const value = valueProp ?? inner;
  const set = (v: string | string[]) => {
    setInner(v);
    onChange?.(v);
  };
  const locked = disabled || !!result;
  const hasValue = Array.isArray(value) ? value.length > 0 : String(value).trim() !== "";

  return (
    <div className={cn("rounded-2xl border border-border bg-card p-5", className)}>
      {label && <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>}
      <p className="text-[15px] font-medium leading-relaxed">{stem}</p>

      {children ? <div className="mt-4">{children}</div> : null}

      {!children && (type === "mcq" || type === "multi") && (
        <div className="mt-4 space-y-2" role={type === "mcq" ? "radiogroup" : "group"} aria-label="Choices">
          {choices.map((c, i) => {
            const selected = Array.isArray(value) ? value.includes(c.id) : value === c.id;
            const isCorrect = result?.correctIds?.includes(c.id);
            const wrongPick = result && selected && !isCorrect;
            return (
              <button
                key={c.id}
                type="button"
                role={type === "mcq" ? "radio" : "checkbox"}
                aria-checked={selected}
                disabled={locked}
                onClick={() => {
                  if (type === "mcq") set(c.id);
                  else {
                    const cur = Array.isArray(value) ? value : [];
                    set(cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]);
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "border-border hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent",
                  selected && !result && "border-foreground/70 bg-muted/60",
                  result && isCorrect && "border-verified/50 bg-verified-soft",
                  wrongPick && "border-foreground/20 bg-muted",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium",
                    selected && !result ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
                    result && isCorrect && "border-verified bg-verified text-white",
                  )}
                >
                  {result && isCorrect ? <Check className="size-3.5" /> : wrongPick ? <X className="size-3.5" /> : LETTERS[i]}
                </span>
                <span className="flex-1">{c.text}</span>
              </button>
            );
          })}
        </div>
      )}

      {!children && (type === "numeric" || type === "short") && (
        <input
          value={String(value)}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && hasValue && !locked && onSubmit?.(value)}
          disabled={locked}
          inputMode={type === "numeric" ? "decimal" : "text"}
          placeholder={type === "numeric" ? "Your answer, e.g. 1/6 or 0.17" : "Your answer"}
          aria-label="Your answer"
          className="mt-4 h-11 w-full rounded-xl border border-border bg-background px-4 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
        />
      )}

      {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}

      {!footer && onSubmit && !result && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={!hasValue || locked}
            onClick={() => onSubmit(value)}
            className="h-9 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export interface ChoiceOptionProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "children"> {
  /** Letter badge, e.g. "A". */
  letter: string;
  children: React.ReactNode;
  /** "radio" (default) or "checkbox". */
  kind?: "radio" | "checkbox";
  /** After grading. */
  state?: "correct" | "incorrect";
}

/**
 * One answer option for custom question bodies. Keeps a REAL native input (ids, name, value, checked,
 * onChange all pass through) so stable selectors and agents keep working; only the look is ours.
 */
export function ChoiceOption({ letter, children, kind = "radio", state, className, disabled, ...input }: ChoiceOptionProps) {
  return (
    <label
      className={cn(
        "group/opt relative flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-[15px] transition-colors hover:bg-muted/60",
        "has-[:checked]:border-foreground/70 has-[:checked]:bg-muted/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        disabled && "cursor-default hover:bg-transparent",
        state === "correct" && "border-verified/50 bg-verified-soft has-[:checked]:border-verified/60 has-[:checked]:bg-verified-soft",
        state === "incorrect" && "border-foreground/20 bg-muted",
        className,
      )}
    >
      <input type={kind} disabled={disabled} className="peer sr-only" {...input} />
      <span
        aria-hidden
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs font-medium text-muted-foreground transition-colors",
          "peer-checked:border-foreground peer-checked:bg-foreground peer-checked:text-background",
          state === "correct" && "border-verified bg-verified text-white peer-checked:border-verified peer-checked:bg-verified",
        )}
      >
        {state === "correct" ? <Check className="size-3.5" /> : state === "incorrect" ? <X className="size-3.5" /> : letter}
      </span>
      <span className="flex-1">{children}</span>
    </label>
  );
}

/** Vertical stack for ChoiceOption. */
export function ChoiceList({ children, label = "Choices" }: { children: React.ReactNode; label?: string }) {
  return (
    <div role="group" aria-label={label} className="space-y-2">
      {children}
    </div>
  );
}

/** Text/numeric answer input matching the option style. Pass id="answer-input" etc. straight through. */
export const AnswerInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function AnswerInput(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-border bg-background px-4 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
});

/** Pill buttons for question footers and inline actions in tutor messages. */
export function PillButton({ variant = "primary", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
        variant === "primary" && "bg-primary text-primary-foreground hover:opacity-90",
        variant === "secondary" && "border border-border bg-background text-foreground hover:bg-muted",
        variant === "ghost" && "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
