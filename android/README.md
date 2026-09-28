# MaraLyrics Admin — Android app

A [Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity/)
wrapping the existing offline-first admin dashboard PWA at
`https://maralyrics.com/admin/`. There's no native Java/Kotlin app code here
on purpose — `AndroidManifest.xml`'s `LauncherActivity` meta-data is the
entire app. All the offline behavior (IndexedDB data store, the sync queue,
conflict resolution, the service worker) is the same code already running at
`public/admin/`; this just gives it a launcher icon, a splash screen, and no
browser chrome.

## Building

CI (`.github/workflows/build-android.yml`) builds this automatically on any
push touching `android/**`, and on demand via the Actions tab's "Run
workflow" button. Download the resulting APK from that run's Artifacts
section.

**One-time setup for a release (verifiable, non-debug) build:** add four
repo secrets under Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 maralyrics-admin-release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | (sent to you alongside the keystore file) |
| `ANDROID_KEY_ALIAS` | `maralyrics-admin` |
| `ANDROID_KEY_PASSWORD` | same as `ANDROID_KEYSTORE_PASSWORD` (PKCS12 keystores use one password for both) |

Without these, the workflow still builds — just a debug-signed APK, which
installs and runs fine for testing but won't match the fingerprint in
`public/.well-known/assetlinks.json`, so Android won't treat app links
(`https://maralyrics.com/admin/...`) as auto-opening this app, and any future
notification-delegation features that check the asset link would be denied.

**The keystore itself is never committed to this repo** (see
`android/.gitignore`) — signing keys don't belong in version control, even
on a private repo. It was generated once, out of band, and handed to you
directly; back it up somewhere safe, since losing it means losing the
ability to publish updates under the same app identity (`com.maralyrics.admin`)
that `assetlinks.json` already trusts.

### Building locally (optional)

Needs Android Studio or a standalone Android SDK (`ANDROID_HOME` set) plus
JDK 17+:

```sh
cd android
./gradlew assembleDebug              # unsigned/debug-signed, for local testing
./gradlew assembleRelease \
  -PRELEASE_STORE_FILE=/path/to/maralyrics-admin-release.keystore \
  -PRELEASE_STORE_PASSWORD=... \
  -PRELEASE_KEY_ALIAS=maralyrics-admin \
  -PRELEASE_KEY_PASSWORD=...
```

## How the pieces fit together

- `app/src/main/AndroidManifest.xml` — the TWA launcher config: which URL
  opens (`https://maralyrics.com/admin/`), status bar/splash colors (matching
  `public/admin/manifest.json`'s theme), and the app-link `intent-filter`
  that lets Android route `maralyrics.com/admin/*` links straight into this
  app once asset links verify.
- `public/.well-known/assetlinks.json` — proves this Android app
  (`com.maralyrics.admin`, signed by the fingerprint listed there) is
  authorized to act on `maralyrics.com`'s behalf. Android checks this over
  HTTPS at install/link-verification time; if the release keystore is ever
  rotated, this file's fingerprint has to be updated to match, or app-link
  verification (and eventually the TWA itself, once Chrome enforces it more
  strictly) will fail.
- `app/src/main/res/mipmap-*/ic_launcher*.png` — generated from
  `public/admin/icon.svg` at each density; regenerate them the same way if
  that source SVG ever changes (see the repo's audit-session notes for the
  exact `cairosvg` invocation, or just re-export at 48/72/96/144/192px).
- Everything else (`build.gradle`, `settings.gradle`, the Gradle wrapper) is
  a standard single-module Android app project — nothing MaraLyrics-specific
  beyond the `applicationId`/`namespace` (`com.maralyrics.admin`) and the
  `androidbrowserhelper` dependency that implements the TWA launcher.

## Why offline still works exactly as before

A TWA is a Custom Tab with the browser UI stripped away — it's still Chrome
under the hood, on the same origin, with the same service worker
(`public/admin/sw.js`), the same IndexedDB database, and the same
`OfflineSync` queue as opening `https://maralyrics.com/admin/` in a normal
tab. Nothing about wrapping it as an Android app changes how offline
editing, the sync queue, or conflict resolution behave — this app is a
launcher and an icon, not a reimplementation.
