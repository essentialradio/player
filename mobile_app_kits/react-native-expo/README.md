# Essential Radio — Expo (React Native) Shell

This is a minimal Expo app using `react-native-webview` to load your site.
Good for quick store submission, with room to evolve into a full native player later.

## Quick start
1) Install Node 18+ and Expo CLI (`npm i -g expo-cli`).
2) In this folder, run:
   ```bash
   npm install
   npm run start
   ```
3) Replace `SITE_URL` in `App.js` with your production player URL.
4) iOS: background audio is enabled via `UIBackgroundModes` in `app.json`. Playback must start from a user tap.

## Next steps
- Swap WebView for a native audio module (e.g., `expo-av`) to get full lock-screen controls and notifications on Android.
- Add push notifications, analytics, and offline pages as needed.
