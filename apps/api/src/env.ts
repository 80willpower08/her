// Resolve the admin password hash from EITHER:
//   • ADMIN_PASSWORD_HASH_B64 (preferred for production) — base64-encoded
//     bcrypt hash. Avoids the `$`-interpolation problem that some orchestrators
//     (notably TrueNAS Apps' YAML pipeline) impose on env values.
//   • ADMIN_PASSWORD_HASH — literal hash. Works fine in dev where `.env` is
//     read directly by Compose without further interpolation.
function resolveAdminPasswordHash(): string {
  const b64 = process.env.ADMIN_PASSWORD_HASH_B64;
  if (b64 && b64.trim()) {
    const decoded = Buffer.from(b64.trim(), 'base64').toString('utf8').trim();
    if (!decoded.startsWith('$2')) {
      throw new Error(
        'ADMIN_PASSWORD_HASH_B64 did not decode to a bcrypt hash (expected to start with $2)'
      );
    }
    return decoded;
  }
  const literal = process.env.ADMIN_PASSWORD_HASH;
  if (!literal) {
    throw new Error('Missing required env: ADMIN_PASSWORD_HASH or ADMIN_PASSWORD_HASH_B64');
  }
  return literal;
}

const required = ['DATABASE_URL', 'JWT_SECRET', 'ADMIN_USERNAME'] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env: ${key}`);
  }
}

const adminPasswordHash = resolveAdminPasswordHash();

export const env = {
  databaseUrl: process.env.DATABASE_URL!,
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
  jwtSecret: process.env.JWT_SECRET!,
  adminUsername: process.env.ADMIN_USERNAME!,
  adminPasswordHash,
  apiPort: parseInt(process.env.API_PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Phase 2: only required when an external account is connected.
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
  googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  msOAuthClientId: process.env.MS_OAUTH_CLIENT_ID ?? '',
  msOAuthClientSecret: process.env.MS_OAUTH_CLIENT_SECRET ?? '',
  // Public origin used to construct OAuth redirect URIs (must match what's
  // registered in Google Cloud Console). For local dev: http://localhost:8080
  publicOrigin: process.env.PUBLIC_ORIGIN ?? 'http://localhost:8080',
  // Shared secret for worker → api internal endpoints. Empty disables them.
  internalApiSecret: process.env.INTERNAL_API_SECRET ?? '',
  // Pre-shared token for ingesting external events (SMS via Tasker, etc.)
  // into /api/share without JWT. Empty disables the alternate auth path.
  ingestToken: process.env.INGEST_TOKEN ?? '',
  // Phase 3: notifications
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:noreply@example.com',
  ntfyUrl: process.env.NTFY_URL ?? 'http://ntfy/',
  ntfyTopic: process.env.NTFY_TOPIC ?? '',
  // User-facing timezone — used to format times in agent context and notifications.
  userTimeZone: process.env.DAILY_AGENT_TZ ?? 'America/Chicago',
  // Where project attachment files live on disk (bound to host via compose).
  attachmentsDir: process.env.ATTACHMENTS_DIR ?? '/data/attachments',
  // Anthropic API key for image-OCR vision calls during project import.
  // If empty, image uploads will skip extraction (still saved as attachments).
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7',
};
