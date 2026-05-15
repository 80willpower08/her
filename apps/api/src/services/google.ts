// Google OAuth + Calendar API helpers.
// Encapsulates token storage (encrypted) and refresh.

import { google } from 'googleapis';
import type { ExternalAccount } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../prisma.js';
import { encryptToken, decryptToken } from '../lib/crypto.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export const GOOGLE_SCOPE_SHEETS = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export const GOOGLE_REDIRECT_PATH = '/api/accounts/google/callback';

export function googleRedirectUri(): string {
  return `${env.publicOrigin}${GOOGLE_REDIRECT_PATH}`;
}

export function buildOAuth2Client() {
  if (!env.googleOAuthClientId || !env.googleOAuthClientSecret) {
    throw new Error('Google OAuth not configured — set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET');
  }
  return new google.auth.OAuth2(
    env.googleOAuthClientId,
    env.googleOAuthClientSecret,
    googleRedirectUri()
  );
}

export function buildAuthUrl(state: string): string {
  const oauth2 = buildOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // ensures we get a refresh token
    scope: GOOGLE_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  email: string | null;
  scopes: string[];
}> {
  const oauth2 = buildOAuth2Client();
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.access_token) throw new Error('Google did not return an access token');

  // Fetch the userinfo to identify the account
  oauth2.setCredentials(tokens);
  const oauth2api = google.oauth2({ version: 'v2', auth: oauth2 });
  const me = await oauth2api.userinfo.get();
  const email = me.data.email ?? null;

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    email,
    scopes: tokens.scope ? tokens.scope.split(' ') : GOOGLE_SCOPES,
  };
}

/**
 * Get an authenticated OAuth2 client for the given account.
 * Refreshes the access token if expired and updates the row.
 */
export async function getAuthenticatedClient(account: ExternalAccount) {
  if (!account.accessTokenEncrypted) throw new Error('Account has no access token');

  const oauth2 = buildOAuth2Client();
  oauth2.setCredentials({
    access_token: decryptToken(account.accessTokenEncrypted),
    refresh_token: account.refreshTokenEncrypted
      ? decryptToken(account.refreshTokenEncrypted)
      : undefined,
    expiry_date: account.tokenExpiresAt?.getTime(),
  });

  // Auto-refresh on token events
  oauth2.on('tokens', async (tokens) => {
    const update: {
      accessTokenEncrypted?: string;
      refreshTokenEncrypted?: string;
      tokenExpiresAt?: Date | null;
    } = {};
    if (tokens.access_token) update.accessTokenEncrypted = encryptToken(tokens.access_token);
    if (tokens.refresh_token) update.refreshTokenEncrypted = encryptToken(tokens.refresh_token);
    if (tokens.expiry_date) update.tokenExpiresAt = new Date(tokens.expiry_date);
    if (Object.keys(update).length > 0) {
      await prisma.externalAccount.update({ where: { id: account.id }, data: update });
    }
  });

  return oauth2;
}

export async function getCalendarClient(account: ExternalAccount) {
  const auth = await getAuthenticatedClient(account);
  return google.calendar({ version: 'v3', auth });
}
