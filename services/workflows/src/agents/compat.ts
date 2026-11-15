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
  const out: Msg[] = [];
  for (const m of prompt) {
    if (m.role === "assistant" && Array.isArray(m.content) && m.content.some((p) => p.type === "tool-call")) {
      const text = m.content
        .map((p) => (p.type === "tool-call" ? `[I called the ${p.toolName} tool with ${json(p.input ?? p.args ?? {})}]` : p.type === "text" ? (p.text ?? "") : ""))
        .filter(Boolean)
        .join("\n");
      out.push({ role: "assistant", content: [{ type: "text", text }] });
    } else if (m.role === "tool" && Array.isArray(m.content)) {
      const text = m.content.map((p) => `Result of the ${p.toolName} tool: ${json(resultValue(p))}`).join("\n");
      out.push({ role: "user", content: [{ type: "text", text: `(tool output, not from the student)\n${text}` }] });
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
