import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Keys live in the repo-root .env.local (docs/CONTRACTS.md). Next only reads apps/web/.env*,
// so load the root files too. process.loadEnvFile never overrides a variable that is already
// set, so the shell and apps/web/.env* still win. Blank template values are left blank.
for (const f of [".env.local", ".env"]) {
  const p = path.resolve(__dirname, "../..", f);
  if (existsSync(p)) process.loadEnvFile(p);
}

const nextConfig: NextConfig = {
  /* config options here */
  transpilePackages: ["@unprompted/shared"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
