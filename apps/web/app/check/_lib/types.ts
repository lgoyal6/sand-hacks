// Client-safe event shape for /check/api (owner: D).
export type CheckEvent =
  | { type: "start"; queries: number; cached: boolean }
  | { type: "query"; n: number; of: number; kind: "exact" | "keyword" }
  | { type: "hit"; site: string; host: string; url: string; matchScore: number; partial: boolean }
  | { type: "done"; found: boolean; sites: string[]; serpCalls: number }
  | { type: "error"; message: string };

