"use client";
// Conversation primitives: Thread (centered 720px column), Message (assistant = plain text, user = gray bubble),
// and a quiet thinking indicator.
import * as React from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { AgentAvatar, resolveAgent } from "@/components/ui/agent-avatar";

export function Thread({ children, className }: { children: React.ReactNode; className?: string }) {
  const end = React.useRef<HTMLDivElement>(null);
  const count = React.Children.count(children);
  React.useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count]);
  return (
    <div className={cn("mx-auto w-full max-w-[720px] space-y-6 px-4 pb-6 pt-8", className)} role="log" aria-live="polite">
      {children}
      <div ref={end} />
    </div>
  );
}

export interface MessageProps {
  /** "assistant"/"tutor" render as plain text; "user"/"student" as a gray bubble on the right. */
  role: "assistant" | "tutor" | "user" | "student";
  /** Small label above an assistant message, e.g. "Explain coach". */
  agentName?: string;
  children: React.ReactNode;
  /** Plain-text version for the copy action (assistant only). */
  copyText?: string;
  onRegenerate?: () => void;
  className?: string;
}

export function Message({ role, agentName, children, copyText, onRegenerate, className }: MessageProps) {
  const [copied, setCopied] = React.useState(false);
  if (role === "user" || role === "student") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={cn("flex justify-end", className)}
      >
        <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-muted px-4 py-2.5 text-[15px] leading-relaxed">{children}</div>
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn("group/msg", className)}
    >
      {agentName && (
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {resolveAgent(agentName) && <AgentAvatar agent={agentName} size="xs" />}
          {agentName}
        </p>
      )}
      <div className="text-[15px] leading-[1.7] text-foreground [&_p+p]:mt-3">{children}</div>
      {(copyText || onRegenerate) && (
        <div className="mt-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
          {copyText && (
            <button
              type="button"
              aria-label="Copy"
              onClick={async () => {
                await navigator.clipboard?.writeText(copyText);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          )}
          {onRegenerate && (
            <button
              type="button"
              aria-label="Regenerate"
              onClick={onRegenerate}
              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

/** A quiet "thinking" line, like Grok's: three soft dots and an optional label. */
export function Thinking({ label = "Thinking" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-muted-foreground/60"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </span>
      {label}
    </div>
  );
}
