// Provider compatibility for Gemini *thinking* models reached through GMI's OpenAI-compatible API.
// Those models require a thought signature on every replayed tool call, which that API can't carry,
// so a second agent step fails with "invalid_thinking_signature". This processor rewrites only the
// outbound prompt (transient; stored history is untouched): earlier tool calls and their results
// become plain text the model can read, so no tool_call messages are replayed.
import type { Processor } from "@mastra/core/processors";

type Part = { type: string; text?: string; toolName?: string; toolCallId?: string; input?: unknown; args?: unknown; output?: unknown; result?: unknown };
type Msg = { role: string; content: string | Part[] };

const json = (x: unknown) => {
  const s = typeof x === "string" ? x : JSON.stringify(x);
  return s.length > 4000 ? `${s.slice(0, 4000)}…` : s;
};
const resultValue = (p: Part) => {
  const o = (p.output ?? p.result) as { type?: string; value?: unknown } | undefined;
  return o && typeof o === "object" && "value" in o ? o.value : o;
};

export function flattenToolHistory(prompt: Msg[]): Msg[] {
  // Past tool calls are NOT rendered as assistant speech: models imitate that and start "calling"
  // tools in plain text. Instead each call+result becomes a reference note from the system side,
  // and the assistant message keeps only the text it actually said.
  const out: Msg[] = [];
  const pending = new Map<string, { name?: string; args: unknown }>();
  for (const m of prompt) {
    if (m.role === "assistant" && Array.isArray(m.content) && m.content.some((p) => p.type === "tool-call")) {
      for (const p of m.content) if (p.type === "tool-call") pending.set(p.toolCallId ?? "", { name: p.toolName, args: p.input ?? p.args ?? {} });
      const said = m.content
        .filter((p) => p.type === "text" && p.text?.trim())
        .map((p) => p.text)
        .join("\n");
      if (said) out.push({ role: "assistant", content: [{ type: "text", text: said }] });
    } else if (m.role === "tool" && Array.isArray(m.content)) {
      const notes = m.content.map((p) => {
        const call = pending.get(p.toolCallId ?? "");
        return `- ${p.toolName ?? call?.name} ${json(call?.args ?? {})} returned: ${json(resultValue(p))}`;
      });
      out.push({
        role: "user",
        content: [{ type: "text", text: `[Reference: results of tools you already ran. Use real tool calls for anything else you need.]\n${notes.join("\n")}` }],
      });
    } else {
      out.push(m);
    }
  }
  return out;
}

export class FlattenToolHistory implements Processor {
  readonly id = "flatten-tool-history";
  processLLMRequest({ prompt, model }: { prompt: unknown; model: { modelId?: string; provider?: string } }) {
    // Only for GMI-routed models; the native Gemini provider round-trips signatures itself.
    const viaGmi = String(model?.provider ?? "").startsWith("gmi");
    return viaGmi ? { prompt: flattenToolHistory(prompt as Msg[]) as never } : {};
  }
}

/**
 * Make sure an agent answers before it runs out of steps: from `answerFrom` on, tools are still
 * described but the model may not call them, so the last step is always a reply.
 */
export class AnswerBeforeLimit implements Processor {
  readonly id = "answer-before-limit";
  constructor(private answerFrom = 4) {}
  processInputStep({ stepNumber }: { stepNumber: number }) {
    return stepNumber >= this.answerFrom ? { toolChoice: "none" as const } : {};
  }
}
