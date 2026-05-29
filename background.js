/**
 * background.js — Service Worker.
 * Регистрирует injected.js в MAIN world, хранит найденные анимации,
 * обрабатывает скачивание.
 */

// ── In-memory хранилище анимаций (ключ: tabId) ──────────────────────────────
const animationStore = new Map();

// ── Регистрация injected.js в MAIN world ─────────────────────────────────────
async function registerInjectedScript() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ['lda-injected'] }).catch(() => {});
    await chrome.scripting.registerContentScripts([{
      id: 'lda-injected',
      matches: ['<all_urls>'],
      js: ['injected.js'],
      runAt: 'document_start',
      world: 'MAIN',
    }]);
    console.log('[LDA] injected.js registered in MAIN world');
  } catch (e) {
    console.warn('[LDA] MAIN world registration failed (будет использован fallback через script-тег):', e.message);
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['injected.js'],
          world: 'MAIN',
        });
      }
    } catch (e2) {}
  }
}

chrome.runtime.onInstalled.addListener(registerInjectedScript);
chrome.runtime.onStartup.addListener(registerInjectedScript);

// ── webRequest: перехват TGS/Lottie из воркеров (MAX, Telegram и др.) ────────
// Воркеры обходят window.fetch — но chrome.webRequest видит все запросы браузера.
// Когда замечаем URL с lottie=true или .tgs, скачиваем из background и обрабатываем.
var _webReqSeen = new Set();
if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
  chrome.webRequest.onBeforeRequest.addListener(
    function (details) {
      var url = details.url;
      if (!/lottie=true|\.tgs(\?|$)/.test(url)) return;
      if (_webReqSeen.has(url)) return;
      _webReqSeen.add(url);
      // Скачиваем из background (sig= в URL — это и есть аутентификация)
      fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        var bytes = new Uint8Array(buf);
        // gzip magic: 1f 8b
        var isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
        if (isGzip) {
          if (typeof DecompressionStream === 'undefined') return;
          var ds = new DecompressionStream('gzip');
          var writer = ds.writable.getWriter();
          var reader = ds.readable.getReader();
          var chunks = [];
          (function read() {
            reader.read().then(function (r2) {
              if (r2.done) {
                var len = chunks.reduce(function (a, c) { return a + c.length; }, 0);
                var merged = new Uint8Array(len);
                var off = 0; chunks.forEach(function (c) { merged.set(c, off); off += c.length; });
                _ldaTryInjectJson(new TextDecoder().decode(merged), url, details.tabId);
              } else { chunks.push(r2.value); read(); }
            }).catch(function () {});
          }());
          try { writer.write(bytes); writer.close(); } catch (e) {}
        } else {
          try { _ldaTryInjectJson(new TextDecoder().decode(bytes), url, details.tabId); } catch (e) {}
        }
      }).catch(function () {
        // Убираем из seen чтобы можно было повторить при следующем запросе
        _webReqSeen.delete(url);
      });
    },
    { urls: ['<all_urls>'], types: ['xmlhttprequest', 'other'] },
    []
  );
}

function _ldaTryInjectJson(text, sourceUrl, tabId) {
  if (!text || text.length < 25) return;
  var first = text.trim()[0];
  if (first !== '{') return;
  if (text.indexOf('"layers"') === -1) return;
  try {
    var data = JSON.parse(text);
    if (!data || !Array.isArray(data.layers)) return;
    if (tabId && tabId > 0) {
      handleDetected(tabId, { animationData: data, source: 'worker', sourceUrl: sourceUrl }, function () {});
    }
  } catch (e) {}
}

// ── Очистка при закрытии вкладки ─────────────────────────────────────────────
chrome.tabs.onRemoved.addListener(function (tabId) {
  var animations = getAnimations(tabId); // сохраняем список ДО удаления из Map
  var keysToRemove = ['meta_' + tabId].concat(
    animations.map(function (a) { return 'data_' + a.id; })
  );
  animationStore.delete(tabId);
  chrome.storage.session.remove(keysToRemove).catch(() => {});
});

// ── Утилиты ──────────────────────────────────────────────────────────────────
function getAnimations(tabId) {
  return animationStore.get(tabId) || [];
}

function fingerprint(data) {
  // Включаем fr, assets и первый слой для надёжной дедупликации
  var str = (data.v || '') + '|' + (data.w || 0) + '|' + (data.h || 0) + '|' +
    (data.layers ? data.layers.length : 0) + '|' +
    (data.nm || '') + '|' + (data.op || 0) + '|' +
    (data.fr || 0) + '|' +
    (data.assets ? data.assets.length : 0) + '|' +
    (data.layers && data.layers[0]
      ? String(data.layers[0].ty || '') + '|' + (data.layers[0].nm || '')
      : '');
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function sourceLabel(source) {
  var map = {
    animationData: 'Inline',
    path: 'Remote JSON',
    fetch: 'Fetch',
    xhr: 'XHR',
    webcomponent: 'Web Component',
    dotlottie: '.lottie',
    worker: 'Worker',
    'worker-fetch': 'Worker',
    'fetch-scan': 'Fetch',
    'dom-svg': 'DOM',
    'dom-element': 'DOM',
    'lottie-registry': 'Lottie API',
  };
  return map[source] || source || 'Unknown';
}

// ── Обработка обнаруженной анимации ──────────────────────────────────────────
function handleDetected(tabId, payload, sendResponse) {
  if (!payload || !payload.animationData) {
    sendResponse({ ok: false });
    return;
  }

  var fp = fingerprint(payload.animationData);
  var animations = getAnimations(tabId);

  var existing = animations.find(function (a) { return a.fingerprint === fp; });
  if (existing) {
    sendResponse({ ok: true, animationId: existing.id, duplicate: true });
    return;
  }

  var record = {
    id: generateId(),
    fingerprint: fp,
    tabId: tabId,
    name: payload.animationData.nm || ('animation_' + (animations.length + 1)),
    domOnly: !!payload.animationData.__domOnly,
    source: sourceLabel(payload.source),
    sourceUrl: payload.sourceUrl || null,
    containerSelector: payload.containerSelector || null,
    width: payload.animationData.w || 0,
    height: payload.animationData.h || 0,
    layers: payload.animationData.layers ? payload.animationData.layers.length : 0,
    frameRate: payload.animationData.fr || 0,
    duration: payload.animationData.op && payload.animationData.fr
      ? (payload.animationData.op / payload.animationData.fr).toFixed(1)
      : null,
    timestamp: Date.now(),
    data: payload.animationData,
  };

  animations.push(record);
  animationStore.set(tabId, animations);

  // Метаданные в session storage (без тяжёлых данных), включая domOnly
  var meta = animations.map(function (a) {
    return {
      id: a.id, name: a.name, source: a.source, sourceUrl: a.sourceUrl,
      containerSelector: a.containerSelector, domOnly: !!a.domOnly,
      width: a.width, height: a.height, layers: a.layers,
      frameRate: a.frameRate, duration: a.duration, timestamp: a.timestamp,
    };
  });
  chrome.storage.session.set({ ['meta_' + tabId]: meta }).catch(() => {});

  // Кэшируем данные анимации для восстановления после перезапуска SW.
  // Пропускаем domOnly-заглушки и файлы крупнее 150 КБ (лимит session storage 1 МБ).
  if (!record.domOnly) {
    try {
      var dataStr = JSON.stringify(record.data);
      if (dataStr.length < 150000) {
        chrome.storage.session.set({
          ['data_' + record.id]: { name: record.name, data: record.data },
        }).catch(function () {
          console.warn('[LDA] session storage full — восстановление после перезапуска SW недоступно для:', record.name);
        });
      }
    } catch (e) {}
  }

  sendResponse({ ok: true, animationId: record.id });
  chrome.runtime.sendMessage({ type: 'ANIMATIONS_UPDATED', tabId: tabId }).catch(() => {});
}

// ── Вспомогательная функция скачивания ───────────────────────────────────────
function doDownload(data, name) {
  var json = JSON.stringify(data, null, 2);
  // TextEncoder → chunked btoa (безопасно для любого Unicode, без deprecated unescape)
  var bytes = new TextEncoder().encode(json);
  var binary = '';
  var chunkSize = 8192;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  var b64 = btoa(binary);

  var filename = (name || 'animation')
    .replace(/[^a-zA-Zа-яА-Я0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'animation';

  chrome.downloads.download({
    url: 'data:application/json;base64,' + b64,
    filename: filename + '.json',
    saveAs: false,
  });
}

// ── Скачивание анимации ───────────────────────────────────────────────────────
function handleDownload(animationId, tabId) {
  var animations = animationStore.get(tabId) || [];
  var record = animations.find(function (a) { return a.id === animationId; });
  if (!record) {
    animationStore.forEach(function (list) {
      if (!record) record = list.find(function (a) { return a.id === animationId; });
    });
  }

  if (record) {
    if (record.domOnly) return; // не скачиваем DOM-заглушки
    doDownload(record.data, record.name);
    return;
  }

  // SW перезапустился — данных в памяти нет, пробуем session storage
  chrome.storage.session.get('data_' + animationId, function (r) {
    var stored = r && r['data_' + animationId];
    if (!stored || !stored.data) return;
    doDownload(stored.data, stored.name);
  });
}

// ── Диспетчер сообщений ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  var tabId = (sender.tab && sender.tab.id) || message.tabId || null;

  if (message.type === 'LOTTIE_DETECTED') {
    handleDetected(tabId, message.payload, sendResponse);
    return true; // async response
  }

  if (message.type === 'DOWNLOAD_ANIMATION') {
    handleDownload(message.animationId, message.tabId || tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'GET_ANIMATIONS') {
    var tid = message.tabId || tabId;
    var inMemory = getAnimations(tid);
    if (inMemory.length > 0) {
      sendResponse(inMemory.map(function (a) {
        return {
          id: a.id, name: a.name, source: a.source, sourceUrl: a.sourceUrl,
          containerSelector: a.containerSelector, domOnly: !!a.domOnly,
          width: a.width, height: a.height, layers: a.layers,
          frameRate: a.frameRate, duration: a.duration, timestamp: a.timestamp,
        };
      }));
      return false;
    }
    // SW перезапустился — берём метаданные из session storage
    chrome.storage.session.get('meta_' + tid, function (result) {
      var meta = (result && result['meta_' + tid]) || [];
      sendResponse(meta);
    });
    return true; // async
  }

  if (message.type === 'GET_ANIMATION_DATA') {
    var aid = message.animationId;
    var found = null;
    animationStore.forEach(function (list) {
      if (!found) found = list.find(function (a) { return a.id === aid; });
    });
    if (found) {
      sendResponse(found.data);
      return false;
    }
    // SW перезапустился — пробуем session storage
    chrome.storage.session.get('data_' + aid, function (r) {
      var stored = r && r['data_' + aid];
      sendResponse(stored ? stored.data : null);
    });
    return true; // async
  }

  if (message.type === 'RESCAN') {
    var rescanTabId = message.tabId || tabId;
    if (rescanTabId) {
      try {
        chrome.tabs.sendMessage(rescanTabId, { type: 'RESCAN' }, function () {
          void chrome.runtime.lastError;
        });
      } catch (e) {}
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'CLEAR_ANIMATIONS') {
    var tid2 = message.tabId || tabId;
    var animations2 = getAnimations(tid2);
    var dataKeys = animations2.map(function (a) { return 'data_' + a.id; });
    animationStore.delete(tid2);
    chrome.storage.session.remove(['meta_' + tid2].concat(dataKeys)).catch(() => {});
    sendResponse({ ok: true });
    // Пересылаем в content_script для очистки оверлеев на странице
    if (tid2) {
      try {
        chrome.tabs.sendMessage(tid2, { type: 'CLEAR_ANIMATIONS' }, function () {
          void chrome.runtime.lastError;
        });
      } catch (e) {}
    }
    chrome.runtime.sendMessage({ type: 'ANIMATIONS_UPDATED', tabId: tid2 }).catch(() => {});
    return false;
  }
});
