# Microsoft Entra ID — one-time app registration for Phase 5

You register one **multi-tenant + personal MSA** app reg in any Entra ID tenant you control (your personal tenant works fine). The same app reg's `Client ID` + `Secret` then handles OAuth for personal Outlook AND any work tenant whose policy permits user consent for third-party apps.

If a work tenant *doesn't* permit user consent, you'll see "Approval required from your administrator" during sign-in. Fall back to ICS calendar publish for that tenant (read-only, calendar only).

---

## 1. Get to the Entra admin center

1. Open **https://entra.microsoft.com**.
2. Sign in with the account that owns the tenant you want to host the app reg in (a personal Entra tenant is fine).
3. Confirm the directory selector (top-right) shows the right tenant. If it's defaulting to a work tenant, **Switch directory** → pick your personal one.
4. Left sidebar → **Applications** → **App registrations**.

> The Azure portal works too if you prefer: `portal.azure.com` → search "Microsoft Entra ID" → **App registrations**.

## 2. Create the app registration

1. Top: **+ New registration**.
2. Fill in:
   - **Name**: something generic like `time-keeper`. This name shows on consent screens for users from other tenants — picking a generic name avoids surfacing your personal tenant's identity in unexpected places.
   - **Supported account types**: **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"**.
   - **Redirect URI**:
     - Platform: **Web**
     - URL: `http://localhost:8080/api/accounts/microsoft/callback`
3. **Register**.
4. From the overview page, copy the **Application (client) ID**.

## 3. Create a client secret

1. Left nav: **Certificates & secrets** → **Client secrets** tab.
2. **+ New client secret**.
3. Description: `time-keeper local`.
4. Expires: **24 months** (max). Rotation reminder when it gets close.
5. **Add**.
6. **Copy the `Value` column immediately** — it's only shown once. The `Secret ID` column is a separate identifier that you don't need.

## 4. API permissions

1. Left nav: **API permissions**.
2. **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**.
3. Check these:
   - `User.Read` (already present by default)
   - `Calendars.Read`
   - `Mail.Read`
   - `offline_access` ← critical, gives us refresh tokens
4. **Add permissions**.
5. Click **Grant admin consent for `<your tenant>`**. This consents on behalf of *your* tenant only — work tenants consent separately at sign-in time.

## 5. Add to `.env`

```
MS_OAUTH_CLIENT_ID=<application client id>
MS_OAUTH_CLIENT_SECRET='<value from step 3, single-quoted>'
```

The single quotes matter if your secret contains a `~`, `$`, or other shell-special character.

Restart the api so it picks up the new env vars:

```bash
docker compose up -d --force-recreate --no-deps api
```

## 6. Connect each account in the app

1. Open http://localhost:8080 → sign in.
2. Settings → **Connected accounts** → **Connect Microsoft**.
3. Pick the Microsoft account to connect. You'll see a consent screen showing the app name, your personal tenant, and the requested permissions.
4. Approve. You're redirected back to `/settings?account=connected`.
5. Hit **↻ Sync now** to pull events immediately.

Repeat for each Microsoft account (personal Outlook + each work tenant).

---

## What to expect per account type

| Account | Likely outcome |
|---|---|
| Your personal Outlook (consumer MSA) | Connects cleanly. |
| Open work tenant (allows user consent) | Consent screen → user approves → connects. |
| Locked-down work tenant | "Approval required from your administrator." Either ask IT, or fall back to ICS publish for calendar only. |
| Work tenant with Conditional Access requiring managed device | Token issuance refused even after consent. Same fallback as above. |

## Common errors and what they mean

- **"Approval required from your administrator"** — work tenant has user consent disabled. Skip OAuth for this account; use ICS publish instead.
- **`AADSTS50011` redirect URI mismatch** — the URI in step 2.3 must match the env's `PUBLIC_ORIGIN` exactly. Default for local: `http://localhost:8080/api/accounts/microsoft/callback`. No trailing slash.
- **`AADSTS65001` no consent recorded** — the user closed the consent screen. Retry; pick "Yes" / "Accept" this time.
- **`AADSTS70008` / `invalid_grant`** — refresh token expired or was revoked. Disconnect the account and reconnect.
- **`AADSTS900561` insufficient permissions** — admin consent flow needed; user-level permissions aren't enough for this scope on this tenant. Stuck with that tenant's IT or fall back.

## Phase 5+ scopes (when we add Drive equivalent)

When we extend to OneDrive or SharePoint, add these scopes to the app reg in step 4 and re-grant admin consent for your home tenant:

- `Files.Read` — read user's OneDrive files
- `Sites.Read.All` — SharePoint sites (work tenants only; commonly admin-restricted)

Reconnect each affected account so the new scopes get added to the consent grant.
