// Minimal Gemini REST client. Server only; the key never reaches the browser.
// Tries a short chain of models: on this key the bigger flash models often return 503 (high demand)
// or 429 (quota), while the flash-lite models answer in about a second. GEMINI_MODEL goes first if set.
import "server-only";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"];

export function geminiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function chain(model?: string) {
  const first = model ?? process.env.GEMINI_MODEL?.trim();
  return [...new Set([first, ...DEFAULT_CHAIN].filter(Boolean) as string[])];
}

export async function geminiJson<T>(
  prompt: string,
  schema: object,
  opts: { model?: string; timeoutMs?: number; temperature?: number } = {},
): Promise<T & { _model: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const errors: string[] = [];
  for (const model of chain(opts.model)) {
    try {
      const res = await fetch(`${BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: opts.temperature ?? 0.7,
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
      if (!res.ok) {
        errors.push(`${model}: ${res.status}`);
        if ([429, 500, 503, 404].includes(res.status)) continue;
        throw new Error(`Gemini ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return { ...(JSON.parse(text) as T), _model: model };
    } catch (err) {
      errors.push(`${model}: ${(err as Error).message.slice(0, 80)}`);
    }
  }
  throw new Error(`all Gemini models failed (${errors.join("; ")})`);
}
