# Lottie Downloader

**Chrome / Yandex Browser extension** that detects, previews and downloads Lottie animations from any website.

![Version](https://img.shields.io/badge/version-1.1.0-6366f1)
![Manifest](https://img.shields.io/badge/manifest-v3-6366f1)
![License](https://img.shields.io/badge/license-MIT-22c55e)

---

## Features

- **Auto-detection** — intercepts Lottie animations loaded via `lottie.loadAnimation()`, `fetch`, `XHR`, `.lottie` (dotLottie ZIP), and web components (`lottie-player`, `dotlottie-player`, `lottie-animation`)
- **Live preview** — hover over a card in the popup to play the animation
- **One-click download** — saves the original JSON file to your Downloads folder
- **Download all** — batch-download every animation found on the page
- **On-page overlay** — a subtle highlight button appears directly on top of every detected animation
- **Highlight & scroll** — click "Find" in the popup to flash and scroll to the animation on the page
- **DOM scan** — finds animations already rendered in SVG even if the library isn't on `window`
- **dotLottie support** — extracts and decompresses `.lottie` ZIP archives (deflate-raw)
- **Service Worker resilience** — animations cached in `session storage`; survive SW restart for files under 150 KB
- **Deduplication** — fingerprint-based, prevents the same animation from appearing twice

---

## Installation

> The extension is not yet published to the Chrome Web Store. Install it manually as an unpacked extension.

1. Download or clone this repository
2. Open Chrome (or Yandex Browser) and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the folder containing `manifest.json`

The extension icon will appear in the toolbar. Navigate to any page with Lottie animations and click the icon to open the popup.

---

## Usage

| Action | How |
|--------|-----|
| See detected animations | Click the extension icon |
| Preview an animation | Hover over the thumbnail in the popup |
| Download one animation | Click **↓ JSON** on its card |
| Download all animations | Click **↓ Скачать все** in the toolbar |
| Re-scan the page | Click **↻ Обновить** |
| Clear the list | Click **✕ Очистить** |
| Highlight on page | Click **👁 Найти** on the card |
| Download from page overlay | Click the **▼ Lottie** button that appears over the animation |

---

## How it works

```
Page (MAIN world)                ISOLATED world           Service Worker
─────────────────                ──────────────           ──────────────
injected.js hooks:               content_script.js        background.js
  lottie.loadAnimation()    →    relays postMessage   →   stores record
  window.fetch              →    to chrome.runtime        notifies popup
  XMLHttpRequest            →    sendMessage
  MutationObserver (web-components)
  DOM scan (SVG / canvas)
  dotLottie ZIP parser
```

`injected.js` runs in the **MAIN world** alongside page scripts so it can intercept the Lottie library before any animation is loaded. It communicates with `content_script.js` (ISOLATED world) via `window.postMessage`. The content script forwards everything to the background service worker, which stores animation data and handles downloads.

---

## Project structure

```
├── manifest.json          — MV3 manifest
├── background.js          — Service Worker: storage, download, message dispatch
├── content_script.js      — ISOLATED world bridge + page overlay management
├── injected.js            — MAIN world hooks (fetch, XHR, lottie API, DOM scan)
├── popup.html / popup.js  — Extension popup UI
├── styles.css             — Page-injected overlay styles
├── lottie_light.min.js    — Bundled lottie-web (light build) for popup previews
├── Motor.json             — UI animation: header logo
├── Lupa.json              — UI animation: empty state
└── icons/                 — Extension icons (16 / 48 / 128 px)
```

---

## Browser compatibility

| Browser | Supported |
|---------|-----------|
| Chrome 116+ | ✅ Full support |
| Yandex Browser | ✅ Full support (fallback for older builds without `world: MAIN`) |
| Edge 116+ | ✅ Should work (Chromium-based) |
| Firefox | ❌ Not supported (MV3 + `world: MAIN` not available) |

---

## Dependencies

| Library | Version | License | Usage |
|---------|---------|---------|-------|
| [lottie-web](https://github.com/airbnb/lottie-web) | 5.x (light build) | MIT | Animation rendering in popup previews |

`lottie_light.min.js` is bundled directly (no npm/build step required).

---

## Known limitations

- Animations larger than **150 KB** (serialized JSON) are not cached in `session storage`. After the Service Worker restarts (Chrome terminates idle SWs after ~30 s), previews and downloads for such animations will be unavailable until the page is rescanned.
- Animations that are **compiled into JavaScript bundles** without being passed through `lottie.loadAnimation()` cannot be extracted.
- `dotLottie` files with compression other than `deflate-raw` (method 8) are not decompressed on browsers without `DecompressionStream` API support.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Author

Made by [OneGog](https://t.me/onegog_design)
