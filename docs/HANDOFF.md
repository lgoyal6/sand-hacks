# Handoff: Unprompted

Everything a teammate needs to pick this up. Product overview, architecture and commands are in the [README](../README.md); team rules are in [CONTRACTS.md](CONTRACTS.md). No secrets are in this file.

## The pitch (backed by our own measurements)

> "You can't write a question an agent can't answer. We measured it: sandboxed browser agents solved every rewrite we tried (8 of 8, across 4 strategies). So Unprompted does the three things that still work: it shows professors which questions are already leaked, rewrites them so a copied answer won't match, and checks understanding by voice."

Headline numbers (all real, all reproducible):

| Claim | Number | Source |
|---|---|---|
| Agents ace our quizzes | 175/175 submitted answers correct across 6 quizzes, 95% CI 97.9-100%, fully sandboxed | `data/fixtures/attack_summaries.json` |
| Rewrites don't stop agents | 0 of 8 measured rewrites resisted (new numbers, real-world, figure-only, find-the-error) | Neon `variant_experiment`, experiment tree |
| Leaked homework | 36% (strict) to 48% (exact phrase) of 500 random textbook exercises are on homework sites; 84% in the 92-exercise pilot | `/study`, `docs/leak-study.md` |
| Typed explanations can be agent-written | 5/5 probes completed by agents via typing ("0 keys for 666 characters") | professor Think-aloud panel |
| Voice required | In a small test, no agent completed a voice think-aloud (0 of 2 reached; confounded by provider errors) | 8f's runtime report |

Do not claim "agent-proof questions". Do not use the 85% figure (the corrected pilot is 84%).

## Where it runs

| What | Where |
|---|---|
| Public deployment | **https://144-202-119-181.sslip.io** (Vultr, Ubuntu 24.04, 2 vCPU / 4 GB, Los Angeles) until the GoDaddy domain is set |
| Server layout | `/opt/unprompted` (git clone of `main`); systemd `unprompted-web` (Next prod on 127.0.0.1:3000) and `unprompted-mastra` (Mastra on :4111); Caddy for HTTPS (`/etc/caddy/Caddyfile`); ufw allows 22/80/443 only |
| Redeploy | `ssh root@144.202.119.181`, then `cd /opt/unprompted && git pull && pnpm install --frozen-lockfile && (cd apps/web && pnpm build) && systemctl restart unprompted-web unprompted-mastra` |
| Pointing a domain | GoDaddy DNS: A records for `@` and `www` to 144.202.119.181, then replace the site name in `/etc/caddy/Caddyfile`, `systemctl reload caddy`, set `PUBLIC_BASE_URL` in `/opt/unprompted/.env.local`, and add the domain to Neon Auth's trusted domains |
| Local dev | `pnpm dev:web` (:3100), `pnpm --filter @unprompted/workflows mastra:dev` (Mastra), `pnpm dev:sandbox` (:3101) |

Demo sign-in: `/signin`, then **Demo student** or **Demo professor** (no password).

## Demo flow (about 3 minutes)

1. **Hook:** backup clip of a sandboxed agent acing a quiz (`sand-hacks-context/demo-videos/`, kept out of git).
2. **Professor studio** (`/studio`): "Attack my quiz" shows the solve rates; "Is any of this online?" shows the leak radar; import a Canvas QTI export to get "N of your questions are online", then "Write a new version"; the race card and experiment tree show Ready lanes next to honest rejections.
3. **Student voice think-aloud:** practice quiz, then "Talk it through", confidence before and after, the calibration moment, and council feedback.
4. **Professor views** (`/professor`, Students roster): explanation scores, mode (voice/typed), typing evidence, "Show what they saw" (Neon time-travel appeal).
5. **Public tools:** `/check` (judges paste a question; QR at `/qr`) and `/study` (open dataset).

If the Wi-Fi or an API fails, the studio's replay mode serves the last real run, clearly labelled "Replaying a recorded run".

## Accounts and keys (values live only in `sand-hacks-context/.env.local`)

Gemini, GMI (Gemini models only), ElevenLabs (agent "Unprompted think-aloud probe"), Bright Data (zones `unprompted_serp`, `unprompted_unlocker` (unused by design), `unprompted_browser`), Neon (project `unprompted`, `raspy-glitter-32585338`), Tiger (service `unprompted`), Vultr (server `unprompted`), Solana devnet notary key (needs faucet funding before anchoring works).

## Known gaps

- Canvas: QTI import/export and the API client have never been tested against a live Canvas instance (no teacher token).
- Voice think-aloud error states (mic denied or silent, dropped call) are code-reviewed but not exercised in a browser.
- The agent-likelihood model was cut; detection is shown as evidence (behavior signals), never a verdict, and n is too small for accuracy claims.
- Solana anchoring shows "not anchored yet" until the devnet wallet is funded.
- OpenStax text was removed from tracked files but remains in git history (the repo is public).

## Shut down after the hackathon

1. Vultr: destroy the `unprompted` server (a stopped server still bills), then delete the API key or disable API access, and the SSH key `unprompted-dat-mac`.
2. Rotate keys that were pasted into chats: Gemini, GMI, and any npm tokens.
3. Optional, free tier: the Neon project, Tiger service, Bright Data zones, ElevenLabs agent.
