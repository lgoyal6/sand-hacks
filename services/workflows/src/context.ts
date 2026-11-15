// Build the transform's live dependencies from env, once. Shared by the CLI and the Mastra workflow.
import { openBranchStore } from "./db/index.js";
import type { BranchStore } from "./db/types.js";
import { CliAttacker, FallbackSolver, GeminiCodeSolver, GeminiGenerator, ModelJudge } from "./steps/adapters.js";
import { directGemini, envVal, gmiGemini, prettyModel } from "./steps/llm.js";
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

/**
 * Gemini only (Dat's call). GMI is just a route to Gemini without the free-tier cap.
 *  - Rewriter:  GEN_MODEL via GMI (default gemini-3.6-flash), else the direct key.
 *  - Solver:    direct key with Gemini's code-execution tool; on quota, GMI without code (reported as such).
 *  - Panel:     three different Gemini models via GMI. One model family, and labelled that way.
 */
export async function buildContext(opts: ContextOptions = {}, env = process.env): Promise<TransformContext> {
  const pick = (m: string) => gmiGemini(m, env) ?? directGemini(m.replace(/^google\//, ""), env);
  const genModel = envVal("GEN_MODEL", env) ?? "gemini-3.6-flash";
  const generator = pick(genModel);
  if (!generator) throw new Error("No Gemini access: set GMI_API_KEY or GEMINI_API_KEY in the repo-root .env.local. Refusing to fake variants.");

  const solverId = envVal("GEMINI_SOLVER_MODEL", env) ?? "gemini-3.6-flash";
  const direct = directGemini(solverId, env);
  const noCode = gmiGemini(solverId, env);
  const solver = new FallbackSolver(direct ? new GeminiCodeSolver(direct, noCode != null) : null, noCode);

  const panelIds = (envVal("PANEL_MODELS", env) ?? "gemini-3.8-flash,gemini-3.6-flash,gemini-3.1-pro-preview").split(",").map((m) => m.trim());
  const seats = panelIds.map(pick).filter((m): m is NonNullable<typeof m> => m != null);
  if (seats.length < 3) throw new Error("The judge panel needs 3 Gemini models (set GMI_API_KEY).");
  const judges = seats.slice(0, 3).map((m) => new ModelJudge(m, `${prettyModel(m.name)} (Gemini panel)`));

  const attacker: Attacker = opts.noAttack
    ? { attack: async () => Promise.reject(new Error("re-attack disabled")) }
    : new CliAttacker({
        repoRoot: REPO_ROOT,
        repeats: opts.attackRepeats ?? 3,
        models: opts.attackModels ?? envVal("ATTACK_MODELS", env),
        log: opts.log,
      });
  const store = await openBranchStore(env);
  return {
    store,
    deps: { generator: new GeminiGenerator(generator), solver, judges, attacker },
    describe: `rewriter ${prettyModel(generator.name)}; solver ${prettyModel(solverId)} with code${gmiGemini(solverId, env) ? " (falls back to no-code via GMI on quota)" : ""}; panel: three Gemini models [${seats.slice(0, 3).map((m) => prettyModel(m.name)).join(", ")}]`,
    independentPanel: false,
  };
}
