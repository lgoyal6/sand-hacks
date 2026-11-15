"use client";
// Big rounded composer. Attach + mic inside on the left, a round send button on the right that turns dark
// when there is text. Voice mode swaps the textarea for the Siri Orb (the one place the orb lives).
import * as React from "react";
import { ArrowUp, Keyboard, Mic, Paperclip, Square } from "lucide-react";
import { VoiceOrb, type VoiceOrbState } from "@/components/ui/siri-orb";
import { agentOrbColors, resolveAgent } from "@/components/ui/agent-avatar";
import { cn } from "@/lib/utils";

export interface ComposerVoice {
  state: VoiceOrbState;
  /** Live transcript or a short hint under the orb. */
  transcript?: string;
  onStop?: () => void;
  /** Shows a "Type instead" affordance. */
  onSwitchToTyping?: () => void;
  /** The agent speaking or listening (e.g. "explain-coach"): the orb takes its hue and the label names it. */
  agent?: string;
}

export interface ComposerProps {
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Stable DOM ids (C uses these for A's agents and tests). */
  textareaId?: string;
  submitId?: string;
  /** Mic button handler. Omit to hide the mic. */
  onMic?: () => void;
  /** Attach button handler. Omit to hide it. */
  onAttach?: () => void;
  /** When set, the composer shows the voice orb instead of the textarea. */
  voice?: ComposerVoice | null;
  autoFocus?: boolean;
  className?: string;
}

export function Composer({
  value: valueProp,
  onChange,
  onSubmit,
  placeholder = "Ask a question or explain your thinking...",
  disabled,
  textareaId,
  submitId,
  onMic,
  onAttach,
  voice,
  autoFocus,
  className,
}: ComposerProps) {
  const [inner, setInner] = React.useState("");
  const value = valueProp ?? inner;
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const set = (v: string) => {
    setInner(v);
    onChange?.(v);
  };
  const canSend = !disabled && value.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    onSubmit?.(value.trim());
    if (valueProp === undefined) setInner("");
  };

  // Auto-grow up to ~8 lines.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [value, voice]);

  const iconBtn =
    "grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";

  if (voice) {
    return (
      <div className={cn("rounded-[28px] border border-border bg-background px-5 pb-4 pt-5 shadow-[0_2px_12px_rgba(0,0,0,0.05)]", className)}>
        <div className="flex flex-col items-center gap-3">
          <VoiceOrb state={voice.state} size="88px" showLabel colors={agentOrbColors(voice.agent)} />
          {resolveAgent(voice.agent) && <p className="-mt-2 text-xs text-muted-foreground">{resolveAgent(voice.agent)!.name}</p>}
          {voice.transcript && <p className="max-w-[560px] text-center text-[15px] leading-relaxed text-foreground/80">{voice.transcript}</p>}
          <div className="flex items-center gap-2">
            {voice.onSwitchToTyping && (
              <button type="button" onClick={voice.onSwitchToTyping} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                <Keyboard className="size-4" /> Type instead
              </button>
            )}
            {voice.onStop && (
              <button type="button" onClick={voice.onStop} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
                <Square className="size-3.5 fill-current" /> Done
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className={cn(
        "rounded-[28px] border border-border bg-background shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-shadow focus-within:border-foreground/20 focus-within:shadow-[0_2px_16px_rgba(0,0,0,0.08)]",
        className,
      )}
    >
      <textarea
        ref={ref}
        id={textareaId}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        className="block w-full resize-none bg-transparent px-5 pb-1 pt-4 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
      />
      <div className="flex items-center gap-1 px-2.5 pb-2.5">
        {onAttach && (
          <button type="button" aria-label="Attach" onClick={onAttach} className={iconBtn} disabled={disabled}>
            <Paperclip className="size-[18px]" />
          </button>
        )}
        {onMic && (
          <button type="button" aria-label="Explain out loud" onClick={onMic} className={iconBtn} disabled={disabled}>
            <Mic className="size-[18px]" />
          </button>
        )}
        <button
          type="submit"
          id={submitId}
          aria-label="Send"
          disabled={!canSend}
          className={cn(
            "ml-auto grid size-9 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            canSend ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-muted text-muted-foreground",
          )}
        >
          <ArrowUp className="size-[18px]" />
        </button>
      </div>
    </form>
  );
}
