// Minimal Gemini REST client with a model fallback chain. Pure: pass the API key in.
// On the team's free-tier key the bigger flash models often return 503 (high demand) or 429 (quota);
// the flash-lite models answer in about a second, so they go first.
export const DEFAULT_GEMINI_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"];

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiOptions {
  apiKey: string;
  models?: string[];
  timeoutMs?: number;
  temperature?: number;
}

export async function geminiJson<T>(prompt: string, schema: object, opts: GeminiOptions): Promise<T & { _model: string }> {
  if (!opts.apiKey) throw new Error("Gemini API key missing");
  const errors: string[] = [];
  for (const model of [...new Set(opts.models?.length ? opts.models : DEFAULT_GEMINI_CHAIN)]) {
    try {
      const res = await fetch(`${BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
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
        if ([404, 429, 500, 503].includes(res.status)) continue;
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

// Fallback through GMI Cloud's OpenAI-compatible API, still Gemini models only (team rule).
export const GMI_GEMINI_CHAIN = ["google/gemini-3.5-flash-lite", "google/gemini-3.5-flash"];

export async function gmiGeminiJson<T>(prompt: string, opts: { apiKey: string; baseUrl: string; models?: string[]; timeoutMs?: number }): Promise<T & { _model: string }> {
  const errors: string[] = [];
  for (const model of opts.models?.length ? opts.models : GMI_GEMINI_CHAIN) {
    if (!model.startsWith("google/gemini")) continue;
    try {
      const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Reply with a single JSON object only, no prose, no code fences." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
      });
      if (!res.ok) {
        errors.push(`${model}: ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = (data.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "");
      return { ...(JSON.parse(text) as T), _model: `gmi:${model}` };
    } catch (err) {
      errors.push(`${model}: ${(err as Error).message.slice(0, 80)}`);
    }
  }
  throw new Error(`GMI Gemini failed (${errors.join("; ")})`);
}
