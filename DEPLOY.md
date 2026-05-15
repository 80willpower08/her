# Deployment — TrueNAS via Cloudflare Tunnel

This guide walks through deploying `her` to TrueNAS Scale and exposing it
publicly via Cloudflare Tunnel. The pattern assumes:

- A TrueNAS Scale host
- A Cloudflare Tunnel terminating TLS upstream (no `cloudflared` container
  in this stack)
- A subdomain you control (e.g., `<app>.example.com`)
- Google Cloud Console OAuth client + Microsoft Entra app registration

## Step 1 — Generate secrets

```bash
# Database password
openssl rand -base64 32

# JWT secret (server-side session signing)
openssl rand -hex 64

# Internal API secret (worker/agent → api auth)
openssl rand -hex 32

# OAuth-token encryption key
openssl rand -hex 32

# Web Push VAPID keys
pnpm dlx web-push generate-vapid-keys
```

Hold all of these aside; they go into the stack YAML.

## Step 2 — OAuth console updates

OAuth callbacks **must be a public HTTPS URL** — Google and Microsoft will
not redirect to internal IPs or `localhost`.

### Google Cloud Console

In your existing OAuth 2.0 Client:

- Add to **Authorized redirect URIs**:
  - `https://<your-subdomain>.example.com/api/accounts/google/callback`
- Add to **Authorized JavaScript origins**:
  - `https://<your-subdomain>.example.com`

Required APIs to have enabled: Calendar, Gmail, Sheets.

### Microsoft Entra app registration

In your existing multi-tenant app registration, under "Web" platform:

- Add to **Redirect URIs**:
  - `https://<your-subdomain>.example.com/api/accounts/microsoft/callback`

## Step 3 — Build & publish images

Push your code to a public GitHub repo. The included
`.github/workflows/build-and-push.yml` builds + pushes the four service
images to GHCR on every `main` push.

After the first push:

1. Open your GitHub repo → **Packages** tab
2. For each of `her-api`, `her-agent`, `her-worker`, `her-web` — open the
   package → **Package settings** → **Change visibility** → **Public**.
   TrueNAS pulls anonymously; public is required unless you wire up
   registry credentials on the host.

## Step 4 — TrueNAS Apps custom-app deploy

In TrueNAS Scale → **Apps** → **Discover Apps** → **Custom App**.

Paste [`deploy/truenas-stack.yml`](deploy/truenas-stack.yml) and replace
every `<PLACEHOLDER>` with the values from Step 1 + your config.

The volumes section creates persistent storage for:

- `postgres-data` — database
- `attachments` — project file attachments (PDFs, images)
- `caddy-data`, `caddy-config` — reverse proxy
- `ntfy-data`, `ntfy-config` — push notification server
- `claude-credentials`, `claude-config` — Claude Code subscription auth

For the **claude-credentials** + **claude-config** volumes, you need to
seed them once on first deploy:

```bash
# On the TrueNAS host, after first deploy:
docker exec -it <her-agent-container> bash
# Inside the container:
claude /login
# Follow the device-code flow; credentials get written to /root/.claude
```

Alternatively, copy your `~/.claude/` directory from your dev machine into
the volume host path.

## Step 5 — Cloudflare Tunnel ingress

On your tunnel host, add an ingress rule for `<app>.example.com` →
`http://<truenas-ip>:8080`. The TrueNAS Caddy listens on port 8080 in
plain HTTP — the tunnel terminates TLS upstream.

## Step 6 — Verify

```bash
curl -sI https://<your-subdomain>.example.com/healthz
# expect 200

curl -sI https://<your-subdomain>.example.com/
# expect 200, vite-built HTML
```

## Step 7 — Migrate from dev (optional)

If you've been running on a dev machine and want to bring data over:

### Database

```bash
# On dev machine:
docker compose exec -T postgres pg_dump -U her -d her -Fc > her-dump.bin

# Copy her-dump.bin to TrueNAS, then:
docker exec -i ix-her-postgres-1 pg_restore -U her -d her --clean --if-exists < her-dump.bin
```

### Attachments

```bash
# On dev machine:
tar -czf her-attachments.tar.gz -C data attachments/

# Copy to TrueNAS, extract into the volume's host path
```

### OAuth tokens

The encrypted OAuth tokens come over with the database dump but will fail
on first use because the redirect URI on the stored token was the dev
machine's URL.

Solution: in the deployed app, disconnect each external account in
Settings → Connected accounts, then reconnect. The reconnect picks up the
production redirect URI cleanly.

## Updates

After each `git push origin main`:

1. GitHub Actions builds new images automatically (~3 min)
2. On TrueNAS, restart the stack — `pull_policy: always` grabs the new
   `:latest` tags

That's it for the deploy cycle.

## Troubleshooting

**Agent runs fail with "claude: command not found"**

The agent container needs Claude Code installed in the image. Check that
`apps/agent/Dockerfile` has the `RUN npm install -g @anthropic-ai/claude-code`
line (it does — but if you've forked, verify).

**Agent runs fail authentication**

The `claude-credentials` volume needs to contain a valid `~/.claude/` dir.
Either copy from your dev machine or run `claude /login` inside the
container once.

**Database connection refused**

Check `DATABASE_URL` matches `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`
in the postgres service. The api container won't start until postgres is
healthy.

**OAuth callback fails with "redirect_uri_mismatch"**

The redirect URI registered in Google/Microsoft console must exactly match
`<PUBLIC_ORIGIN>/api/accounts/<provider>/callback`. Re-check spelling,
trailing slashes, http vs https.

**Cloudflare tunnel 502s**

The tunnel forwards to `http://<truenas-ip>:8080`. Confirm port 8080 is
mapped on the Caddy container and that Caddy is healthy
(`docker ps` — look for `Up` status).
