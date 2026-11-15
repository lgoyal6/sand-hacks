// Neon services for the Unprompted web app (owner: C). Managed Better Auth on the team's existing project.
// Env is never auto-pulled here: run `neon env pull --file .env.neon.local` and copy only NEON_AUTH_* into the
// repo-root .env.local, so the team's DATABASE_URL is never overwritten.
import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
});
