# Google Cloud Console — one-time setup for Phase 2

You only need to do this once for your personal Google account. The result is a `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` you paste into `.env`.

This stays in **Testing** mode (no app verification needed) — you'll add yourself as a test user.

---

## 1. Create a project

1. Go to https://console.cloud.google.com/.
2. Top bar → project dropdown → **New Project**. Name it `time-keeper` (or whatever). Click **Create**.
3. Make sure the new project is selected in the top bar.

## 2. Enable the Calendar API

1. Left sidebar → **APIs & Services** → **Library**.
2. Search **Google Calendar API** → click it → **Enable**.

(Phase 5 will also need Drive API and Gmail API — enable them later when those phases land. Skip for now.)

## 3. Configure the OAuth consent screen

1. Left sidebar → **APIs & Services** → **OAuth consent screen**.
2. **User Type**: choose **External** unless you have Google Workspace (then Internal is simpler — no test-user list needed). Click **Create**.
3. Fill in:
   - **App name**: `time-keeper`
   - **User support email**: your email
   - **Developer contact information**: your email
   - Leave logo, app domain, etc. empty
4. Click **Save and Continue**.
5. **Scopes**: click **Add or Remove Scopes**. Filter and check:
   - `…/auth/calendar.readonly`
   - `…/auth/userinfo.email`
   - `openid`
   Click **Update** → **Save and Continue**.
6. **Test users**: click **+ Add Users**, add your own Google email. Save and Continue.
7. **Summary**: click **Back to Dashboard**.

> The app will stay in **Testing** mode — only listed test users can use it. That's fine for personal use. Don't click "Publish App" — that triggers Google's verification process and you don't need it.

## 4. Create the OAuth client credentials

1. Left sidebar → **APIs & Services** → **Credentials**.
2. **+ Create Credentials** → **OAuth client ID**.
3. **Application type**: **Web application**.
4. **Name**: `time-keeper local` (or similar).
5. **Authorized redirect URIs**: click **+ Add URI** and paste exactly:
   ```
   http://localhost:8080/api/accounts/google/callback
   ```
   When you eventually deploy through the Cloudflare Tunnel, add the public URI too — e.g., `https://time-keeper.yourdomain.tld/api/accounts/google/callback`. Both can coexist.
6. Click **Create**.
7. A modal shows your **Client ID** and **Client Secret**. Copy both.

## 5. Paste into `.env`

In the project root:

```
GOOGLE_OAUTH_CLIENT_ID=...   ← paste client ID here
GOOGLE_OAUTH_CLIENT_SECRET=...   ← paste client secret here
```

Then restart the api container so it picks up the new env vars:

```bash
docker compose restart api
```

## 6. Connect your account in the app

1. Open http://localhost:8080.
2. Sign in with your time-keeper credentials (`will` / `admin`).
3. Click the gear icon → **Settings**.
4. Under **Connected accounts**, click **Connect Google account**.
5. You're redirected to Google — pick your account, click through the consent screen.
   - If you see a "Google hasn't verified this app" warning, that's expected (Testing mode). Click **Advanced** → **Go to time-keeper (unsafe)**.
6. After consent, Google redirects back to `/settings?account=connected`.
7. Click the **Sync now** ↻ button on the new account row to pull events immediately. Otherwise the worker syncs every 15 minutes.
8. Visit **Today** to see events alongside tasks.

---

## Common issues

**`redirect_uri_mismatch`** during consent: the URI in step 4.5 must match exactly. Including `http://` (not `https`) for local dev, the port `8080`, and the path `/api/accounts/google/callback`. No trailing slash.

**`access_denied` after consent**: you weren't added as a test user in step 3.6. Add yourself.

**Account shows `NEEDS_REAUTH` later**: refresh tokens can be revoked or expire. Disconnect and reconnect.

**Refresh token missing** (event sync starts working then stops after ~1 hour): we set `prompt=consent` and `access_type=offline` in the auth URL specifically to get a refresh token, but Google sometimes doesn't return one if you've previously authorized the app and didn't revoke. Workaround: go to https://myaccount.google.com/permissions, remove the time-keeper app, then reconnect.

## Phase 5 follow-up

When we add Drive and Gmail (phase 5), revisit this same OAuth client and:
- Enable Drive API and Gmail API in step 2
- Add the additional scopes to the consent screen in step 3.5
- The same client ID/secret continues to work; the user just re-authorizes with broader scopes
