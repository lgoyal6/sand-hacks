// Gemini only (Dat's call). Agents reach Gemini through GMI's OpenAI-compatible API when
// GMI_API_KEY is set (no free-tier cap), else Mastra's google provider on the direct key.
import { envVal } from "../steps/llm.js";

export type AgentModel = string | { providerId: string; modelId: string; url: string; apiKey: string };

/**
 * Default for tool-using agents: gemini-3.5-flash-lite. Through GMI's OpenAI-compatible API, every
 * Gemini 3.x *thinking* model rejects multi-step tool calls ("invalid_thinking_signature": the
 * thought signature can't round-trip through that API). 3.5-flash-lite doesn't need one. Tested 2026-11-15.
 */
export function gemini(model = envVal("AGENT_MODEL") ?? "gemini-3.5-flash-lite"): AgentModel {
  const key = envVal("GMI_API_KEY");
  if (key) return { providerId: "gmi", modelId: `google/${model}`, url: envVal("GMI_BASE_URL") ?? "https://api.gmi-serving.com/v1", apiKey: key };
  // Mastra's google provider reads GOOGLE_GENERATIVE_AI_API_KEY.
  const direct = envVal("GEMINI_API_KEY");
  if (direct && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) process.env.GOOGLE_GENERATIVE_AI_API_KEY = direct;
  return `google/${model}`;
}
