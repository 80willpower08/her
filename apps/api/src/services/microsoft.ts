// Microsoft Graph OAuth + REST helpers.
// Multi-tenant + personal-MSA via the /common endpoint. Tokens encrypted at rest.

import type { ExternalAccount } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../prisma.js';
import { encryptToken, decryptToken } from '../lib/crypto.js';

const AUTHORITY = 'https://login.microsoftonline.com/common';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export const MS_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Calendars.Read',
  'Mail.Read',
];

export const MS_REDIRECT_PATH = '/api/accounts/microsoft/callback';

export function microsoftRedirectUri(): string {
  return `${env.publicOrigin}${MS_REDIRECT_PATH}`;
}

function ensureConfigured(): void {
  if (!env.msOAuthClientId || !env.msOAuthClientSecret) {
    throw new Error(
      'Microsoft OAuth not configured — set MS_OAUTH_CLIENT_ID and MS_OAUTH_CLIENT_SECRET'
    );
  }
}

export function buildMsAuthUrl(state: string): string {
  ensureConfigured();
  const params = new URLSearchParams({
    client_id: env.msOAuthClientId,
    response_type: 'code',
    redirect_uri: microsoftRedirectUri(),
    response_mode: 'query',
    scope: MS_SCOPES.join(' '),
    state,
    // prompt=select_account so the user can pick which Microsoft account to
    // connect rather than silently reusing whatever was last used.
    prompt: 'select_account',
  });
  return `${AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export interface MsTokenExchangeResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  email: string | null;
  displayName: string | null;
}

export async function exchangeCodeForMsTokens(code: string): Promise<MsTokenExchangeResult> {
  ensureConfigured();
  const body = new URLSearchParams({
    client_id: env.msOAuthClientId,
    client_secret: env.msOAuthClientSecret,
    code,
    redirect_uri: microsoftRedirectUri(),
    grant_type: 'authorization_code',
    scope: MS_SCOPES.join(' '),
  });
  const res = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: HTTP ${res.status}: ${text}`);
  }
  const tokens = (await res.json()) as TokenResponse;

  // Pull user identity from /me
  const me = await msGraphFetch<{
    id: string;
    displayName: string;
    userPrincipalName: string;
    mail: string | null;
  }>(tokens.access_token, '/me');

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    scopes: tokens.scope ? tokens.scope.split(' ') : MS_SCOPES,
    email: me.mail ?? me.userPrincipalName ?? null,
    displayName: me.displayName ?? null,
  };
}

/**
 * Refresh the access token if it's expired/near-expiring. Updates the row
 * in-place. Returns a usable access token for the caller.
 */
export async function getMsAccessToken(account: ExternalAccount): Promise<string> {
  if (!account.accessTokenEncrypted) throw new Error('Account has no access token');
  const accessToken = decryptToken(account.accessTokenEncrypted);
  const exp = account.tokenExpiresAt ? account.tokenExpiresAt.getTime() : 0;
  // Refresh if less than 60s of life left
  if (exp - Date.now() > 60_000) return accessToken;

  if (!account.refreshTokenEncrypted) {
    throw new Error('Access token expired and no refresh token available — reconnect required');
  }
  ensureConfigured();
  const body = new URLSearchParams({
    client_id: env.msOAuthClientId,
    client_secret: env.msOAuthClientSecret,
    refresh_token: decryptToken(account.refreshTokenEncrypted),
    grant_type: 'refresh_token',
    scope: MS_SCOPES.join(' '),
  });
  const res = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: HTTP ${res.status}: ${text}`);
  }
  const tokens = (await res.json()) as TokenResponse;

  const update: {
    accessTokenEncrypted: string;
    tokenExpiresAt: Date;
    refreshTokenEncrypted?: string;
  } = {
    accessTokenEncrypted: encryptToken(tokens.access_token),
    tokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
  };
  if (tokens.refresh_token) {
    update.refreshTokenEncrypted = encryptToken(tokens.refresh_token);
  }
  await prisma.externalAccount.update({ where: { id: account.id }, data: update });
  return tokens.access_token;
}

/** Generic Graph GET. Throws on non-OK. */
export async function msGraphFetch<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph ${path} HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}
