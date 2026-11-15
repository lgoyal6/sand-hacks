# Deployment (Vultr)

Live at https://144-202-119-181.sslip.io (deployed by the orchestrator session).

- **Host**: one Vultr Ubuntu VM. The firewall allows only 22, 80 and 443.
- **HTTPS**: Caddy reverse proxy with automatic certificates for the sslip.io hostname (no DNS records needed). To use a GoDaddy domain, add `A @` and `A www` records pointing to the VM IP and add the domain to the Caddyfile.
- **Web**: Next.js production build (`pnpm --filter @unprompted/web build`, then `next start`) under systemd.
- **Workflows**: B's Mastra server (`mastra dev` in `services/workflows`) under systemd on port 4111, reached by the web app through `MASTRA_URL`.
- **Not deployed**: the code sandbox.
- **Env**: runtime secrets live in an env file on the VM only, never in git. Solana is devnet only (`lib/notary` refuses other clusters). `PUBLIC_BASE_URL` is set to the public URL so `/qr` points to `/check`.
