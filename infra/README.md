# Deployment (Vultr)

Live at **https://unprompted.courses** (also https://144-202-119-181.sslip.io).

- **Host**: one Vultr Ubuntu VM. The firewall allows only 22, 80 and 443.
- **Domain**: `unprompted.courses`, registered at Porkbun. DNS: `A @` and `A www` → 144.202.119.181.
- **HTTPS**: Caddy reverse proxy with automatic certificates for `unprompted.courses` and the sslip.io hostname; `www` redirects to the apex. Both origins are Neon Auth trusted domains.
- **Web**: Next.js production build (`pnpm --filter @unprompted/web build`, then `next start`) under systemd.
- **Workflows**: B's Mastra server (`mastra dev` in `services/workflows`) under systemd on port 4111, reached by the web app through `MASTRA_URL`.
- **Not deployed**: the code sandbox.
- **Env**: runtime secrets live in an env file on the VM only, never in git. Solana is devnet only (`lib/notary` refuses other clusters). `PUBLIC_BASE_URL=https://unprompted.courses` so `/qr` points to `/check`.
