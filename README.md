# Lottie Downloader

**Расширение для Chrome и Яндекс Браузера**, которое автоматически находит, показывает превью и скачивает Lottie-анимации с любого сайта.

![Версия](https://img.shields.io/badge/версия-1.1.0-6366f1)
![Manifest](https://img.shields.io/badge/manifest-v3-6366f1)
![Лицензия](https://img.shields.io/badge/лицензия-MIT-22c55e)

---

## Возможности

- **Авто-обнаружение** — перехватывает анимации, загружаемые через `lottie.loadAnimation()`, `fetch`, `XHR`, файлы `.lottie` (dotLottie ZIP) и веб-компоненты (`lottie-player`, `dotlottie-player`, `lottie-animation`)
- **Превью анимаций** — наведите на карточку в попапе, чтобы воспроизвести анимацию
- **Скачивание одним кликом** — сохраняет оригинальный JSON-файл в папку «Загрузки»
- **Скачать все** — пакетная загрузка всех найденных анимаций сразу
- **Оверлей на странице** — поверх каждой найденной анимации появляется кнопка скачивания прямо на сайте
- **Подсветка и скролл** — кнопка «👁 Найти» в попапе вспыхивает и прокручивает страницу к нужной анимации
- **Сканирование DOM** — находит уже отрисованные SVG-анимации, даже если библиотека не доступна через `window`
- **Поддержка dotLottie** — распаковывает `.lottie` ZIP-архивы (deflate-raw)
- **Устойчивость к перезапуску** — анимации кэшируются в `session storage` и переживают перезапуск Service Worker (для файлов до 150 КБ)
- **Дедупликация** — один и тот же файл не появится в списке дважды

---

## Установка

> Расширение пока не опубликовано в Chrome Web Store. Устанавливается вручную как распакованное расширение.

1. Скачайте или клонируйте этот репозиторий
2. Откройте Chrome (или Яндекс Браузер) и перейдите на `chrome://extensions/`
3. Включите **Режим разработчика** (переключатель в правом верхнем углу)
4. Нажмите **Загрузить распакованное**
5. Выберите папку, в которой находится `manifest.json`

Иконка расширения появится на панели инструментов. Откройте любой сайт с Lottie-анимациями и нажмите на иконку.

---

## Как пользоваться

| Действие | Как выполнить |
|----------|---------------|
| Посмотреть найденные анимации | Нажать на иконку расширения |
| Воспроизвести анимацию | Навести курсор на миниатюру в попапе |
| Скачать одну анимацию | Нажать **↓ JSON** на карточке |
| Скачать все анимации | Нажать **↓ Скачать все** на панели |
| Повторно просканировать страницу | Нажать **↻ Обновить** |
| Очистить список | Нажать **✕ Очистить** |
| Найти анимацию на странице | Нажать **👁 Найти** на карточке |
| Скачать прямо со страницы | Нажать кнопку **▼ Lottie** над анимацией |

---

## Как это работает

```
Страница (MAIN world)               ISOLATED world           Service Worker
─────────────────────               ──────────────           ──────────────
injected.js перехватывает:          content_script.js        background.js
  lottie.loadAnimation()       →    ретранслирует        →   сохраняет запись
  window.fetch                 →    postMessage              уведомляет попап
  XMLHttpRequest               →    через sendMessage
  MutationObserver (веб-компоненты)
  DOM-сканирование (SVG / canvas)
  dotLottie ZIP-парсер
```

`injected.js` выполняется в **MAIN world** вместе со скриптами страницы — это позволяет перехватить библиотеку Lottie до того, как загрузится первая анимация. Он общается с `content_script.js` (ISOLATED world) через `window.postMessage`. Контент-скрипт пересылает всё в фоновый Service Worker, который хранит данные и управляет скачиванием.

---

## Структура проекта

```
├── manifest.json           — MV3-манифест расширения
├── background.js           — Service Worker: хранилище, скачивание, диспетчер сообщений
├── content_script.js       — ISOLATED world: мост + управление оверлеями на странице
├── injected.js             — MAIN world: хуки fetch/XHR/lottie API, сканирование DOM
├── popup.html / popup.js   — UI всплывающего окна расширения
├── popup-animations.js     — Данные UI-анимаций (встроены в код, без внешних файлов)
├── styles.css              — Стили оверлеев, инжектируемые в страницу
├── lottie_light.min.js     — Bundled lottie-web (light) для превью в попапе
└── icons/                  — Иконки расширения (16 / 48 / 128 px)
```

---

## Совместимость браузеров

| Браузер | Поддержка |
|---------|-----------|
| Chrome 116+ | ✅ Полная поддержка |
| Яндекс Браузер | ✅ Полная поддержка (fallback для старых сборок без `world: MAIN`) |
| Edge 116+ | ✅ Должен работать (на базе Chromium) |
| Firefox | ❌ Не поддерживается (MV3 + `world: MAIN` недоступны) |

---

## Зависимости

| Библиотека | Версия | Лицензия | Использование |
|------------|--------|----------|---------------|
| [lottie-web](https://github.com/airbnb/lottie-web) | 5.x (light) | MIT | Воспроизведение анимаций в превью попапа |

`lottie_light.min.js` включён напрямую в репозиторий — сборка не требуется.

---

## Известные ограничения

- Анимации тяжелее **150 КБ** (сериализованный JSON) не кэшируются в `session storage`. После перезапуска Service Worker (Chrome завершает неактивные SW примерно через 30 с) превью и скачивание таких анимаций будут недоступны до повторного сканирования страницы.
- Анимации, **скомпилированные внутрь JS-бандла** без вызова `lottie.loadAnimation()`, не могут быть извлечены.
- Файлы `.lottie` со сжатием, отличным от `deflate-raw` (метод 8), не декомпрессируются в браузерах без поддержки `DecompressionStream` API.

---

## Лицензия

MIT — подробности в файле [LICENSE](LICENSE).

---

## Автор

Сделано [OneGog](https://t.me/onegog_design)

---
---

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

---

## Project structure

```
├── manifest.json          — MV3 manifest
├── background.js          — Service Worker: storage, download, message dispatch
├── content_script.js      — ISOLATED world bridge + page overlay management
├── injected.js            — MAIN world hooks (fetch, XHR, lottie API, DOM scan)
├── popup.html / popup.js  — Extension popup UI
├── popup-animations.js    — Inlined UI animation data (no loose JSON files)
├── styles.css             — Page-injected overlay styles
├── lottie_light.min.js    — Bundled lottie-web (light build) for popup previews
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

`lottie_light.min.js` is bundled directly — no build step required.

---

## Known limitations

- Animations larger than **150 KB** (serialized JSON) are not cached in `session storage`. After the Service Worker restarts, previews and downloads for such animations will be unavailable until the page is rescanned.
- Animations **compiled into JavaScript bundles** without going through `lottie.loadAnimation()` cannot be extracted.
- `.lottie` files with compression other than `deflate-raw` (method 8) are not decompressed on browsers without the `DecompressionStream` API.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Author

Made by [OneGog](https://t.me/onegog_design)
