# Essential Radio — Capacitor Shell

This folder contains a ready-to-wire Capacitor project that packages your existing web app for iOS/Android.

## Quick start
1) Ensure Node 18+ is installed.
2) Run:
   ```bash
   npm install
   npx cap add ios
   npx cap add android
   ```
3) Put your built site files into `./web` (already seeded with `index.html`). If you have a build step, make it output here.
4) Sync and open projects:
   ```bash
   npx cap sync
   npm run ios   # opens Xcode
   npm run android  # opens Android Studio
   ```

## iOS setup (Background audio)
- In Xcode, select the iOS target → Signing & Capabilities → **+ Capability** → **Background Modes**
- Tick **Audio, AirPlay, and Picture in Picture**
- Ensure playback starts from a user gesture (required by iOS).

## Android setup (Background audio)
- In `AndroidManifest.xml`, add a foreground service for audio and request a MediaStyle notification (many plugins/examples exist).
- Start simple by relying on your page controls; add native media-notification later via a plugin if needed.

## Notes
- If you use a dev server, set `server.url` in `capacitor.config.ts` to your machine LAN URL for live reload.
- Add app icons/splash in respective native projects after `npx cap add ...`.
