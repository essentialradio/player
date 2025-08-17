# Essential Radio — PWA Pack

Files included:
- `manifest.json` — app metadata & icons
- `sw.js` — service worker for caching
- `index.pwa.html` — your index.html with the manifest + SW registration injected

## How to use
1) Copy `manifest.json` to your site root and serve it at `/manifest.json`.
2) Copy `sw.js` to your site root and serve it at `/sw.js`.
3) Merge the changes from `index.pwa.html` into your real `index.html` (or just replace it if you're happy).
4) Host icons at `/icons/icon-192.png` and `/icons/icon-512.png`.
5) Deploy over HTTPS. Visit on mobile → “Add to Home Screen”.

Tip: Extend `ASSETS` in `sw.js` with your CSS/JS/fonts for faster startup.
