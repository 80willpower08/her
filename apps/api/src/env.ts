const required = ['DATABASE_URL', 'JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH'] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env: ${key}`);
  }
}

export const env = {
  databaseUrl: process.env.DATABASE_URL!,
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
  jwtSecret: process.env.JWT_SECRET!,
  adminUsername: process.env.ADMIN_USERNAME!,
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH!,
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
