# her-companion (Android)

A single-purpose Android companion app for [her](../../). Captures every notification
that posts to the status bar (SMS, Teams, Outlook, Gmail snippets, Slack, etc.)
and POSTs them to `https://your-her.example.com/api/share` with the pre-shared
`X-Ingest-Token`. Nothing else. No analytics. No remote config. No telemetry.

## Audit checklist (read before installing)

The whole app is under 500 lines. The files that matter for trust:

| File | Lines | What to look for |
|---|---|---|
| `app/src/main/AndroidManifest.xml` | ~35 | **Only** `INTERNET`, `POST_NOTIFICATIONS`, `BIND_NOTIFICATION_LISTENER_SERVICE` are declared. No SMS, contacts, storage, location, microphone, camera. |
| `app/src/main/java/com/her/companion/HerNotificationListener.kt` | ~70 | The only callback the listener exposes. Allowlist gate before any forwarding. No file writes, no DB. |
| `app/src/main/java/com/her/companion/Forwarder.kt` | ~50 | The only network call in the app. Look at the URL — it comes from your saved `Settings.shareUrl`, not hardcoded. |
| `app/src/main/java/com/her/companion/Settings.kt` | ~70 | EncryptedSharedPreferences — the ingest token is AES-256-GCM at rest. |
| `app/src/main/java/com/her/companion/SettingsActivity.kt` | ~85 | The only Activity. No webviews. No native code. |
| `app/src/main/java/com/her/companion/LruDedupCache.kt` | ~25 | Dedupe utility. Pure data structure, no IO. |
| `app/build.gradle.kts` | ~30 | **No** Firebase, Crashlytics, Analytics, Ads, or telemetry dependencies. Just `androidx.core` + `security-crypto`. |

If anything in those files looks off, the install never happens.

## Build (one-time, from your dev machine)

Requirements: Android Studio + Android SDK (one-time install, ~6GB).

```bash
cd apps/companion-android
./gradlew assembleRelease
# APK lands at app/build/outputs/apk/release/app-release-unsigned.apk
```

The APK is unsigned in this template. For sideload-only personal use, sign it
locally with a personal keystore:

```bash
keytool -genkey -v -keystore ~/.android/her-companion.keystore \
        -keyalg RSA -keysize 2048 -validity 36500 -alias her-companion
~/Android/Sdk/build-tools/<ver>/apksigner sign \
        --ks ~/.android/her-companion.keystore \
        --out her-companion.apk \
        app/build/outputs/apk/release/app-release-unsigned.apk
```

## Sideload

1. Transfer `her-companion.apk` to your phone (USB, Google Drive, email to yourself)
2. On the phone, enable **Settings → Apps → Special app access → Install unknown apps**
   for your file manager
3. Open the APK from your file manager → Install
4. Open the her-companion app
5. Paste in:
   - **Share endpoint URL** — `https://her.phnet.me/api/share`
   - **Ingest token** — the `INGEST_TOKEN` from her's server env
   - **Allowlist** — start with: `com.google.android.apps.messaging,com.microsoft.teams,com.google.android.gm,com.microsoft.office.outlook`
6. Tap **Open Notification Access settings** → toggle on for her-companion
7. Tap **Send test notification** — should land as a row in her's inbox within seconds

## When to revoke

If you ever want to fully disable this:
- Android Settings → Notifications → Notification access → her-companion → Off
- Or uninstall the app

The ingest token can also be rotated server-side (regenerate `INGEST_TOKEN`)
which immediately invalidates the companion's auth without uninstalling it.
