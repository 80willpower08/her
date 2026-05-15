// Generic HTTP-GET feed sync. Supports several auth modes; read-only only.
//
// Sync flow:
//   1. If COOKIE_LOGIN, POST to loginPath with loginBody; extract Set-Cookie.
//   2. GET baseUrl+endpointPath with the appropriate auth header(s) (or cookie).
//   3. Parse JSON if Content-Type is JSON; otherwise store as text.
//   4. Persist as snapshot. Cap size; mark truncated if exceeded.

import type { DataSource } from '@prisma/client';
import { prisma } from '../prisma.js';

const SNAPSHOT_BYTES_CAP = 512 * 1024; // 512KB stored per source

interface AuthBearer {
  token: string;
}
interface AuthBasic {
  username: string;
  password: string;
}
interface AuthCookieLogin {
  loginPath: string;
  loginMethod?: 'POST' | 'GET';
  loginBody?: Record<string, unknown>;
  loginContentType?: string; // defaults to application/json
}
interface AuthCustomHeaders {
  headers: Record<string, string>;
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return b + p;
}

/** Parse Set-Cookie header(s) into a "name=value; name=value" Cookie string. */
function cookiesFromSetCookie(headers: Headers): string {
  // Node fetch exposes set-cookie as a comma-joined string OR raw entries via
  // headers.getSetCookie() (when available). Use the modern method when
  // available, fall back to single-string parse.
  const cookies: string[] = [];
  const anyHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof anyHeaders.getSetCookie === 'function') {
    for (const raw of anyHeaders.getSetCookie()) {
      const [nameValue] = raw.split(';');
      if (nameValue && nameValue.includes('=')) cookies.push(nameValue.trim());
    }
  } else {
    const raw = headers.get('set-cookie');
    if (raw) {
      // Best-effort: split on commas that precede a token=token pattern.
      const parts = raw.split(/,\s*(?=[A-Za-z0-9_-]+=)/);
      for (const part of parts) {
        const [nameValue] = part.split(';');
        if (nameValue && nameValue.includes('=')) cookies.push(nameValue.trim());
      }
    }
  }
  return cookies.join('; ');
}

async function preflightCookieLogin(
  source: DataSource,
  staticHeaders: Record<string, string>
): Promise<{ cookie: string } | { error: string }> {
  const cfg = source.authConfig as AuthCookieLogin | null;
  if (!cfg?.loginPath) return { error: 'COOKIE_LOGIN requires loginPath' };

  const url = joinUrl(source.baseUrl, cfg.loginPath);
  const method = cfg.loginMethod ?? 'POST';
  const contentType = cfg.loginContentType ?? 'application/json';
  const body = cfg.loginBody ? JSON.stringify(cfg.loginBody) : undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...staticHeaders,
        ...(body ? { 'Content-Type': contentType } : {}),
        Accept: 'application/json',
      },
      body,
      // We don't follow redirects automatically because we want headers from
      // the first response. (fetch default does follow — that's OK for login
      // most of the time, but the cookie may be on an intermediate response.)
    });
  } catch (err) {
    return { error: `login fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { error: `login HTTP ${res.status}: ${t.slice(0, 200)}` };
  }

  const cookie = cookiesFromSetCookie(res.headers);
  if (!cookie) return { error: 'login succeeded but no Set-Cookie returned' };
  return { cookie };
}

export async function syncDataSource(source: DataSource): Promise<
  | { ok: true; sizeBytes: number; truncated: boolean }
  | { ok: false; error: string }
> {
  const staticHeaders = (source.staticHeaders as Record<string, string> | null) ?? {};
  const mainHeaders: Record<string, string> = { ...staticHeaders, Accept: 'application/json' };

  // Resolve auth → either header(s) or a cookie string.
  if (source.authMode === 'BEARER') {
    const cfg = source.authConfig as AuthBearer | null;
    if (!cfg?.token) return failSync(source, 'BEARER requires token');
    mainHeaders.Authorization = `Bearer ${cfg.token}`;
  } else if (source.authMode === 'BASIC') {
    const cfg = source.authConfig as AuthBasic | null;
    if (!cfg?.username || !cfg?.password) return failSync(source, 'BASIC requires username + password');
    const encoded = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
    mainHeaders.Authorization = `Basic ${encoded}`;
  } else if (source.authMode === 'CUSTOM_HEADERS') {
    const cfg = source.authConfig as AuthCustomHeaders | null;
    if (cfg?.headers) Object.assign(mainHeaders, cfg.headers);
  } else if (source.authMode === 'COOKIE_LOGIN') {
    const result = await preflightCookieLogin(source, staticHeaders);
    if ('error' in result) return failSync(source, result.error);
    mainHeaders.Cookie = result.cookie;
  }
  // NONE: no auth headers

  const url = joinUrl(source.baseUrl, source.endpointPath);
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers: mainHeaders });
  } catch (err) {
    return failSync(source, `fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return failSync(source, `HTTP ${res.status}: ${t.slice(0, 500)}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  const isJson = contentType.toLowerCase().includes('application/json');

  // Read body up to cap. If we hit the cap mid-stream, mark truncated.
  const buf = Buffer.from(await res.arrayBuffer());
  const sizeBytes = buf.byteLength;
  const truncated = sizeBytes > SNAPSHOT_BYTES_CAP;
  const slice = truncated ? buf.subarray(0, SNAPSHOT_BYTES_CAP) : buf;

  let parsed: unknown;
  if (isJson && !truncated) {
    try {
      parsed = JSON.parse(slice.toString('utf-8'));
    } catch {
      parsed = slice.toString('utf-8');
    }
  } else {
    // Truncated JSON would parse-fail; store as text with a marker.
    parsed = slice.toString('utf-8') + (truncated ? '\n[...truncated]' : '');
  }

  await prisma.dataSource.update({
    where: { id: source.id },
    data: {
      snapshot: {
        data: parsed,
        fetchedAt: new Date().toISOString(),
        status: res.status,
        sizeBytes,
        truncated,
        contentType,
      } as unknown as object,
      lastSyncedAt: new Date(),
      lastError: null,
    },
  });

  return { ok: true, sizeBytes, truncated };
}

async function failSync(source: DataSource, error: string): Promise<{ ok: false; error: string }> {
  await prisma.dataSource.update({
    where: { id: source.id },
    data: { lastError: error.slice(0, 1000), lastSyncedAt: new Date() },
  });
  return { ok: false, error };
}

/** Find sources whose next sync is due. */
export async function findDueDataSources(now = new Date()): Promise<DataSource[]> {
  const candidates = await prisma.dataSource.findMany({
    where: { enabled: true, syncCadence: { in: ['HOURLY', 'DAILY', 'WEEKLY'] } },
  });
  return candidates.filter((s) => {
    if (!s.lastSyncedAt) return true;
    const interval =
      s.syncCadence === 'HOURLY'
        ? 3_600_000
        : s.syncCadence === 'DAILY'
          ? 86_400_000
          : 7 * 86_400_000;
    return now.getTime() - s.lastSyncedAt.getTime() >= interval;
  });
}
