import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

/** Read an env var; empty, whitespace-only or comment-only values count as unset. */
export function envVal(k: string, env = process.env): string | undefined {
  const v = env[k]?.trim();
  return v && !v.startsWith("#") ? v : undefined;
}

/** A chat model that returns JSON validated against a zod schema. */
export interface JsonModel {
  name: string;
  json<T>(prompt: string, schema: z.ZodType<T>, opts?: { temperature?: number; system?: string }): Promise<T>;
}

async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String((e as Error)?.message ?? e);
      // Retry rate limits, server errors and malformed JSON; fail fast on auth/bad requests.
      if (/\b(400|401|403|404)\b/.test(msg) && !/RESOURCE_EXHAUSTED/.test(msg)) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw new Error(`${label} failed: ${String((last as Error)?.message ?? last).slice(0, 400)}`);
}

export class GeminiModel implements JsonModel {
  readonly name: string;
  private ai: GoogleGenAI;
  constructor(apiKey: string, readonly model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.name = `gemini:${model}`;
  }

  async json<T>(prompt: string, schema: z.ZodType<T>, opts: { temperature?: number; system?: string } = {}): Promise<T> {
    return withRetry(async () => {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          temperature: opts.temperature,
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(schema),
        },
      });
      return schema.parse(JSON.parse(res.text ?? ""));
    }, this.name);
  }

  /**
   * Free-form answer with Gemini's built-in Python code execution tool.
   * Returns the response text and whether the model actually ran code.
   */
  async withCode(prompt: string, opts: { temperature?: number } = {}): Promise<{ text: string; usedCode: boolean }> {
    return withRetry(async () => {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: { temperature: opts.temperature, tools: [{ codeExecution: {} }] },
      });
      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const usedCode = parts.some((p) => p.executableCode || p.codeExecutionResult);
      const text = parts.map((p) => p.text ?? "").join("\n");
      return { text, usedCode };
    }, `${this.name} (code)`);
  }
}

/** GMI Cloud: OpenAI-compatible chat completions for open models (Qwen, DeepSeek, Llama). */
export class OpenAICompatModel implements JsonModel {
  readonly name: string;
  constructor(
    private baseUrl: string,
    private apiKey: string,
    readonly model: string,
    prefix = "gmi",
  ) {
    this.name = `${prefix}:${model}`;
  }

  async json<T>(prompt: string, schema: z.ZodType<T>, opts: { temperature?: number; system?: string } = {}): Promise<T> {
    const shape = JSON.stringify(z.toJSONSchema(schema));
    return withRetry(async () => {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          temperature: opts.temperature ?? 0.2,
          response_format: { type: "json_object" },
          messages: [
            ...(opts.system ? [{ role: "system", content: opts.system }] : []),
            { role: "user", content: `${prompt}\n\nReply with only a JSON object matching this JSON Schema:\n${shape}` },
          ],
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 300)}`);
      const content: string = JSON.parse(text).choices?.[0]?.message?.content ?? "";
      // Some open models wrap JSON in prose or fences, or emit <think> blocks first.
      const body = content.replace(/<think>[\s\S]*?<\/think>/g, "");
      const start = body.indexOf("{");
      const end = body.lastIndexOf("}");
      return schema.parse(JSON.parse(body.slice(start, end + 1)));
    }, this.name);
  }
}

export interface Models {
  gemini: GeminiModel;
  /** Extra panel seats from other model families; empty when GMI_API_KEY is missing. */
  others: JsonModel[];
}

/** Build models from env, or null when GEMINI_API_KEY is missing (callers then refuse to run). */
export function modelsFromEnv(env = process.env): Models | null {
  const key = envVal("GEMINI_API_KEY", env);
  if (!key) return null;
  const gemini = new GeminiModel(key, envVal("GEMINI_MODEL", env) ?? "gemini-2.5-flash");
  const gmiKey = envVal("GMI_API_KEY", env);
  const others: JsonModel[] = [];
  if (gmiKey) {
    const base = envVal("GMI_BASE_URL", env) ?? "https://api.gmi-serving.com/v1";
    // Model ids are configurable because GMI's catalog changes; check `GET $GMI_BASE_URL/models`.
    const ids = (envVal("GMI_PANEL_MODELS", env) ?? "deepseek-ai/DeepSeek-V3.2,Qwen/Qwen3-235B-A22B-Instruct-2507")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of ids) others.push(new OpenAICompatModel(base, gmiKey, id));
  }
  return { gemini, others };
}
