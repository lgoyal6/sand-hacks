// Build the transform's live dependencies from env, once. Shared by the CLI and the Mastra workflow.
import { openBranchStore } from "./db/index.js";
import type { BranchStore } from "./db/types.js";
import { buildPanel, CliAttacker, GeminiCodeSolver, GeminiGenerator } from "./steps/adapters.js";
import { envVal, GeminiModel, modelsFromEnv } from "./steps/llm.js";
import type { Attacker, TransformDeps } from "./steps/types.js";

import { REPO_ROOT } from "./paths.js";
export { REPO_ROOT };

export interface TransformContext {
  store: BranchStore;
  deps: TransformDeps;
  /** Human-readable model setup, e.g. for logs and the studio. */
  describe: string;
  independentPanel: boolean;
}

export interface ContextOptions {
  /** Skip the agent re-attack (nothing can be verified without it). */
  noAttack?: boolean;
  attackRepeats?: number;
  attackModels?: string;
  log?: (s: string) => void;
}

export async function buildContext(opts: ContextOptions = {}, env = process.env): Promise<TransformContext> {
  const models = modelsFromEnv(env);
  if (!models) throw new Error("GEMINI_API_KEY is not set in the repo-root .env.local; refusing to fake variants.");
  const key = envVal("GEMINI_API_KEY", env)!;
  const solverModel = new GeminiModel(key, envVal("GEMINI_SOLVER_MODEL", env) ?? "gemini-3.6-flash");
  const fallbackSeats = (envVal("GEMINI_PANEL_FALLBACKS", env) ?? "gemini-3.6-flash,gemini-3.5-flash-lite")
    .split(",")
    .map((m) => new GeminiModel(key, m.trim()));
  const panel = buildPanel(models.gemini, models.others, fallbackSeats);
  const attacker: Attacker = opts.noAttack
    ? { attack: async () => Promise.reject(new Error("re-attack disabled")) }
    : new CliAttacker({
        repoRoot: REPO_ROOT,
        repeats: opts.attackRepeats ?? 3,
        models: opts.attackModels ?? envVal("ATTACK_MODELS", env) ?? "gemini:gemini-3.5-flash",
        log: opts.log,
      });
  const store = await openBranchStore(env);
  return {
    store,
    deps: { generator: new GeminiGenerator(models.gemini), solver: new GeminiCodeSolver(solverModel), judges: panel.judges, attacker },
    describe: `generator ${models.gemini.name}, solver ${solverModel.name}, panel [${panel.judges.map((j) => j.name).join("; ")}]`,
    independentPanel: panel.independentFamilies,
  };
}
