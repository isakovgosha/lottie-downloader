/**
 * injected.js — выполняется в MAIN world до скриптов страницы.
 * Перехватывает Lottie-анимации через хуки lottie API, fetch, XHR и web-компоненты.
 */
(function () {
  'use strict';

  // Защита от двойного запуска (background.js + script-тег могут оба вставить этот файл)
  if (window.__ldaInjected) return;
  window.__ldaInjected = true;

  var EXTENSION_FLAG = '__lottieDownloaderExt__';

  // --- Отправить данные в content_script (ISOLATED world) ---
  function emit(payload) {
    var msg = { type: payload.type };
    msg[EXTENSION_FLAG] = true;
    for (var k in payload) { if (k !== 'type') msg[k] = payload[k]; }
    window.postMessage(msg, '*');
  }

  // --- Эвристика: является ли объект Lottie JSON ---
  function isLottieData(obj) {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      'v' in obj &&
      ('w' in obj || 'fr' in obj) &&
      Array.isArray(obj.layers) &&
      obj.layers.length > 0
    );
  }

  // --- Генерация CSS-селектора для DOM-элемента ---
  function getSelectorFor(el) {
    if (!el || !(el instanceof Element)) return null;
    if (el.id) {
      try { return '#' + CSS.escape(el.id); } catch (e) { return '#' + el.id; }
    }
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        try { part = '#' + CSS.escape(node.id); } catch (e) { part = '#' + node.id; }
        parts.unshift(part);
        break;
      }
      if (!node.parentNode) return null; // detached — неполный селектор бесполезен
      var idx = Array.prototype.indexOf.call(node.parentNode.children, node);
      part += ':nth-child(' + (idx + 1) + ')';
      parts.unshift(part);
      node = node.parentNode;
    }
    return parts.join(' > ') || null;
  }

  // --- Найти ближайший контейнер-кандидат для Lottie в DOM ---
  // Ищем элементы, которые сейчас содержат SVG или canvas (рендерер Lottie)
  function findLottieContainerInDOM() {
    // 1. Поиск по data-атрибутам Lottie-плееров
    var candidates = document.querySelectorAll(
      '[data-lottie], [data-animation], .lottie, .lottie-player, ' +
      'dotlottie-player, lottie-player, lottie-animation'
    );
    if (candidates.length > 0) return candidates[0];

    // 2. Поиск SVG, созданных Lottie (содержат <defs> и <g transform>)
    var svgs = document.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      if (svg.querySelector('defs') && svg.querySelector('g[transform]') &&
          svg.parentElement && svg.parentElement.tagName !== 'BODY') {
        var r = svg.getBoundingClientRect();
        if (r.width > 30 && r.height > 30) {
          return svg.parentElement;
        }
      }
    }

    // 3. Canvas внутри видимого блока
    var canvases = document.querySelectorAll('canvas');
    for (var j = 0; j < canvases.length; j++) {
      var c = canvases[j];
      var rect = c.getBoundingClientRect();
      if (rect.width > 30 && rect.height > 30 && c.parentElement) {
        return c.parentElement;
      }
    }

    return null;
  }

  // --- Распаковка gzip (TGS / VK-стикеры) ---
  function tryDecompressGzip(bytes, url, source) {
    if (typeof DecompressionStream === 'undefined') return;
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return; // не gzip
    var ds = new DecompressionStream('gzip');
    var writer = ds.writable.getWriter();
    var reader = ds.readable.getReader();
    var chunks = [];
    (function read() {
      reader.read().then(function (r) {
        if (r.done) {
          var len = chunks.reduce(function (a, c) { return a + c.length; }, 0);
          var merged = new Uint8Array(len);
          var off = 0; chunks.forEach(function (c) { merged.set(c, off); off += c.length; });
          try { tryEmitJson(new TextDecoder().decode(merged), url, source, null); } catch (e) {}
        } else { chunks.push(r.value); read(); }
      }).catch(function () {});
    }());
    try { writer.write(bytes); writer.close(); } catch (e) {}
  }

  // --- Парсинг и отправка JSON-текста ---
  function tryEmitJson(text, sourceUrl, source, container) {
    if (!text || text.length < 25 || text.length > 8000000) return; // <25 байт или >8МБ — пропуск
    // Быстрая проверка: Lottie-JSON начинается с { и содержит "layers"
    var first = text.trim()[0];
    if (first !== '{') return;
    if (text.indexOf('"layers"') === -1 && text.indexOf("'layers'") === -1) return;
    try {
      var data = JSON.parse(text);
      if (isLottieData(data)) {
        var selector = getSelectorFor(container);
        // Если нет container — попробуем найти в DOM через небольшую задержку
        if (!selector) {
          setTimeout(function () {
            var found = findLottieContainerInDOM();
            emit({
              type: 'LOTTIE_DETECTED',
              source: source,
              animationData: data,
              sourceUrl: sourceUrl || null,
              containerSelector: getSelectorFor(found),
            });
          }, 150);
        } else {
          emit({
            type: 'LOTTIE_DETECTED',
            source: source,
            animationData: data,
            sourceUrl: sourceUrl || null,
            containerSelector: selector,
          });
        }
      }
    } catch (e) { /* не валидный JSON */ }
  }

  // --- Загрузить URL и отправить как анимацию ---
  function fetchAndEmit(url, container, source) {
    if (!url || typeof url !== 'string') return;
    var absUrl;
    try { absUrl = new URL(url, location.href).href; } catch (e) { return; }

    // Используем исходный (незамоченный) fetch
    var fn = window.__ldaOriginalFetch || window.fetch;
    fn(absUrl, { credentials: 'same-origin' })
      .then(function (resp) {
        var ct = resp.headers.get('content-type') || '';
        if (absUrl.endsWith('.lottie') || ct.includes('dotlottie') || ct.includes('application/zip')) {
          return resp.arrayBuffer().then(function (buf) {
            extractDotLottie(buf, container, source);
          });
        }
        return resp.text().then(function (text) {
          tryEmitJson(text, absUrl, source, container);
        });
      })
      .catch(function () {});
  }

  // --- Обёртка loadAnimation ---
  function wrapLoadAnimation(originalFn) {
    return function (params) {
      var result;
      try { result = originalFn.apply(this, arguments); } catch (e) { throw e; }
      try {
        if (params && typeof params === 'object') {
          if (params.animationData && isLottieData(params.animationData)) {
            emit({
              type: 'LOTTIE_DETECTED',
              source: 'animationData',
              animationData: params.animationData,
              sourceUrl: null,
              containerSelector: getSelectorFor(params.container),
            });
          } else if (params.path) {
            fetchAndEmit(params.path, params.container, 'path');
          }
        }
      } catch (e) {}
      return result;
    };
  }

  // --- Хук глобала lottie / bodymovin ---
  function hookGlobal(name) {
    var _value = window[name];

    function wrapIfNeeded(obj) {
      if (obj && typeof obj.loadAnimation === 'function' && !obj.__ldaHooked) {
        obj.loadAnimation = wrapLoadAnimation(obj.loadAnimation);
        obj.__ldaHooked = true;
      }
    }

    wrapIfNeeded(_value);

    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function () { return _value; },
        set: function (newVal) { _value = newVal; wrapIfNeeded(_value); },
      });
    } catch (e) {}
  }

  hookGlobal('lottie');
  hookGlobal('bodymovin');

  // --- Перехват fetch ---
  // Сохраняем оригинал ДО оборачивания, чтобы fetchAndEmit не зациклился
  window.__ldaOriginalFetch = window.fetch;
  var _originalFetch = window.fetch;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input
      : (input && typeof input === 'object' && input.url) ? input.url : '';
    var promise = _originalFetch.apply(this, arguments);

    // Проверяем URL и пробуем читать ответ
    if (url && shouldTryParsing(url)) {
      promise.then(function (resp) {
        var ct = resp.headers.get('content-type') || '';
        var urlPath = url.split('?')[0].toLowerCase();
        var isDotLottie = urlPath.endsWith('.lottie') || ct.includes('dotlottie');

        // .lottie (dotLottie ZIP) — направляем в ZIP-парсер, минуя фильтры
        if (isDotLottie || ct.includes('application/zip')) {
          resp.clone().arrayBuffer().then(function (buf) {
            extractDotLottie(buf, null, 'fetch');
          }).catch(function () {});
          return;
        }

        // .tgs / gzip-сжатый Lottie JSON (VK, Telegram-стикеры)
        var isTgs = urlPath.endsWith('.tgs') || ct.includes('octet-stream');
        if (isTgs) {
          resp.clone().arrayBuffer().then(function (buf) {
            tryDecompressGzip(new Uint8Array(buf), url, 'fetch');
          }).catch(function () {});
          return;
        }

        // Пропускаем явно бинарные типы (но не application/json и text/*)
        if (/text\/html|text\/css|image\/|video\/|audio\/|font\/|application\/(javascript|pdf|wasm)/.test(ct)) return;
        // Пропускаем по размеру если Content-Length известен
        var cl = parseInt(resp.headers.get('content-length') || '-1', 10);
        if (cl >= 0 && (cl < 500 || cl > 8000000)) return;
        try {
          resp.clone().text().then(function (text) {
            tryEmitJson(text, url, 'fetch', null);
          }).catch(function () {});
        } catch (e) {}
      }).catch(function () {});
    }

    return promise;
  };

  // --- Перехват XHR ---
  var _originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ldaUrl = typeof url === 'string' ? url : '';
    _originalOpen.apply(this, arguments);
  };

  var _originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    var url = self.__ldaUrl || '';
    if (url && shouldTryParsing(url)) {
      self.addEventListener('load', function () {
        try {
          var ct = self.getResponseHeader('content-type') || '';
          // arraybuffer — проверяем на gzip (TGS / VK-стикеры)
          if (self.responseType === 'arraybuffer' && self.response instanceof ArrayBuffer) {
            tryDecompressGzip(new Uint8Array(self.response), url, 'xhr');
            return;
          }
          // responseText недоступен при responseType !== '' | 'text' — бросает InvalidStateError
          if (self.responseType && self.responseType !== '' && self.responseType !== 'text') return;
          if (ct && /image\/|video\/|audio\/|font\/|application\/(zip|pdf|octet-stream|wasm)/.test(ct)) return;
          tryEmitJson(self.responseText, url, 'xhr', null);
        } catch (e) {}
      });
    }
    return _originalSend.apply(this, arguments);
  };

  // --- Хук Worker (инъекция fetch-перехватчика внутрь воркера) ---
  // MAX/Telegram: воркер сам конструирует URL и вызывает fetch изнутри.
  // window.fetch там не виден. Решение: оборачиваем воркер через blob + importScripts,
  // вставляя наш fetch-хук до запуска оригинального скрипта.
  if (typeof Worker !== 'undefined') {
    var _OriginalWorker = window.Worker;

    // Код, исполняемый внутри воркера — перехватывает fetch и отправляет Lottie-данные обратно
    var _WORKER_INJECT = '(function(){'
      + 'var _f=self.fetch;'
      + 'self.fetch=function(input,init){'
      +   'var u=typeof input==="string"?input:(input&&input.url)||"";'
      +   'var p=_f.apply(this,arguments);'
      +   'if(u&&/lottie=true|\\.tgs(\\?|$)/.test(u)){'
      +     'p.then(function(r){return r.clone().arrayBuffer();})'
      +      '.then(function(b){try{self.postMessage({__lda:1,url:u,buf:b},[b]);}catch(e){}})'
      +      '.catch(function(){});'
      +   '}'
      +   'return p;'
      + '};'
      + '})();';

    window.Worker = function (scriptURL, options) {
      var isModule = options && options.type === 'module';

      // Blob-инъекция: только для http(s) не-модульных воркеров
      if (!isModule && typeof scriptURL === 'string' && /^https?:/.test(scriptURL)) {
        try {
          var src = _WORKER_INJECT + '\nimportScripts(' + JSON.stringify(scriptURL) + ');';
          var blob = new Blob([src], { type: 'text/javascript' });
          var blobUrl = URL.createObjectURL(blob);
          var w = new _OriginalWorker(blobUrl, options);
          // Принимаем перехваченные данные от нашего хука внутри воркера
          w.addEventListener('message', function (ev) {
            if (ev.data && ev.data.__lda === 1 && ev.data.buf instanceof ArrayBuffer) {
              var bytes = new Uint8Array(ev.data.buf);
              if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
                tryDecompressGzip(bytes, ev.data.url, 'worker');
              } else {
                try { tryEmitJson(new TextDecoder().decode(bytes), ev.data.url, 'worker', null); } catch (e) {}
              }
            }
          });
          return w;
        } catch (e) { /* CSP или другая ошибка — fallback */ }
      }

      // Fallback: обычный воркер + перехват postMessage (если URL передаётся явно)
      var w2 = new _OriginalWorker(scriptURL, options);
      var _origPost = w2.postMessage.bind(w2);
      w2.postMessage = function (data, transfer) {
        if (data && typeof data === 'object') {
          var keys = ['src', 'url', 'source', 'file', 'animationUrl'];
          for (var ki = 0; ki < keys.length; ki++) {
            var val = data[keys[ki]];
            if (val && typeof val === 'string' && shouldTryParsing(val)) {
              (function (u) {
                _originalFetch(u).then(function (r) { return r.arrayBuffer(); })
                  .then(function (buf) {
                    var bytes = new Uint8Array(buf);
                    if (bytes[0] === 0x1f && bytes[1] === 0x8b) tryDecompressGzip(bytes, u, 'worker');
                    else try { tryEmitJson(new TextDecoder().decode(bytes), u, 'worker', null); } catch (e) {}
                  }).catch(function () {});
              }(val));
              break;
            }
          }
        }
        return transfer !== undefined ? _origPost(data, transfer) : _origPost(data);
      };
      return w2;
    };
    window.Worker.prototype = _OriginalWorker.prototype;
  }

  // Должны ли мы попытаться распарсить ответ с этого URL?
  function shouldTryParsing(url) {
    if (typeof url !== 'string') return false;
    // Пропускаем служебные схемы браузера
    if (/^(chrome|chrome-extension|moz-extension|about|data|blob):/.test(url)) return false;
    var u = url.split('?')[0].split('#')[0].toLowerCase();
    // Всегда берём .json, .lottie, .tgs (gzip Lottie — Telegram/MAX стикеры)
    if (/\.(json|lottie|tgs)$/.test(u)) return true;
    // Пропускаем явно бинарные/код расширения
    if (/\.(js|mjs|css|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|mp4|webm|mp3|wav|ogg|zip|gz|pdf|map|ts|m3u8)$/.test(u)) return false;
    // Берём URL, в которых есть признаки данных анимации (icon/media/render убраны — слишком широкие)
    if (/lottie|animation|sticker|asset|player|anim/.test(u)) return true;
    // Берём известные CDN и API-домены с анимациями
    if (/vk-cdn\.net|st\.vk\.com|vkvideo\.ru|userapi\.com|telegram\.org|t\.me|cdn\.tlgr\.org|cdn4\.telegram|lottiefiles\.com|lottieicon\.com|iconscout\.com|dotlottie|airbnb\.io/.test(url)) return true;
    // Пропускаем типичные API без признаков анимации (авторизация, аналитика, метрики)
    if (/auth|login|logout|track|metric|analytic|pixel|beacon|log\b|csrf|token|session/.test(u)) return false;
    // Для остальных — берём если путь не имеет расширения (API-эндпоинт, который может вернуть JSON)
    return /\/[^/]*\.[a-z0-9]{1,6}$/.test(u) === false && u.length < 200;
  }

  // --- Шаг 1: достать данные из реестра lottie.getRegisteredAnimations() ---
  // Lottie хранит ВСЕ активные экземпляры с animationData внутри AnimationManager.
  // Работает когда библиотека присвоена window.lottie ИЛИ window.bodymovin.
  var _reportedFingerprints = new Set();

  function emitFromRegistry(lottieObj) {
    if (!lottieObj || typeof lottieObj.getRegisteredAnimations !== 'function') return;
    try {
      var items = lottieObj.getRegisteredAnimations();
      if (!Array.isArray(items)) return;
      items.forEach(function (item) {
        var data = item.animationData || (item.animationItem && item.animationItem.animationData);
        if (!data || !isLottieData(data)) return;
        // Формула должна совпадать с fingerprint() в background.js для корректной дедупликации
        var fp = (data.v || '') + '|' + (data.w || 0) + '|' + (data.h || 0) + '|' +
          (data.layers ? data.layers.length : 0) + '|' +
          (data.nm || '') + '|' + (data.op || 0) + '|' +
          (data.fr || 0) + '|' +
          (data.assets ? data.assets.length : 0) + '|' +
          (data.layers && data.layers[0]
            ? String(data.layers[0].ty || '') + '|' + (data.layers[0].nm || '')
            : '');
        if (_reportedFingerprints.has(fp)) return;
        _reportedFingerprints.add(fp);
        emit({
          type: 'LOTTIE_DETECTED',
          source: 'lottie-registry',
          animationData: data,
          sourceUrl: item.path || null,
          containerSelector: getSelectorFor(item.wrapper || item.container),
        });
      });
    } catch (e) {}
  }

  function tryRegistry() {
    emitFromRegistry(window.lottie);
    emitFromRegistry(window.bodymovin);
  }

  // --- Шаг 2: сканирование DOM для SVG с метками Lottie ---
  // Fallback когда lottie не на window: ищем SVG с __lottie_element_ ID
  var _reportedSvgContainers = new Set();

  function isLottieSvg(svg) {
    // Только надёжный признак: ID __lottie_element_ проставляется самой библиотекой lottie-web
    return !!svg.querySelector('[id^="__lottie_element_"], [clip-path*="__lottie_element_"]');
  }

  function scanDomForLottieSvg() {
    // Сначала пробуем реестр — вдруг window.lottie теперь доступен
    tryRegistry();

    var svgs = document.querySelectorAll('svg');
    svgs.forEach(function (svg) {
      if (!isLottieSvg(svg)) return;

      var container = svg.parentElement;
      if (!container || _reportedSvgContainers.has(container)) return;

      // Пропускаем невидимые SVG
      var rect = svg.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;

      _reportedSvgContainers.add(container);

      // Пробуем найти animationData прямо на контейнере
      // (некоторые плееры сохраняют данные как JS-свойство элемента)
      var data = container._lottieData || container.__lottieAnimationData
        || container._animation || null;

      if (data && isLottieData(data)) {
        // Данные есть на элементе — отправляем полноценную анимацию
        emit({
          type: 'LOTTIE_DETECTED',
          source: 'dom-element',
          animationData: data,
          sourceUrl: null,
          containerSelector: getSelectorFor(container),
        });
        return;
      }

      // Данных нет — сообщаем как dom-svg (overlay без скачивания)
      var vb = svg.getAttribute('viewBox') || '';
      var vbParts = vb.trim().split(/\s+|,/);
      var w = parseInt(vbParts[2]) || Math.round(rect.width);
      var h = parseInt(vbParts[3]) || Math.round(rect.height);
      var nm = svg.closest('[data-name]') && svg.closest('[data-name]').dataset.name || ('SVG ' + w + '×' + h);

      emit({
        type: 'LOTTIE_DETECTED',
        source: 'dom-svg',
        animationData: { v: '5', w: w, h: h, fr: 0, op: 0, nm: nm, layers: [{}], __domOnly: true },
        sourceUrl: null,
        containerSelector: getSelectorFor(container),
      });
    });
  }

  // Слушаем команду повторного сканирования от content_script (через попап)
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    if (ev.data && ev.data.__ldaRescan) {
      // Сбрасываем дедупликацию — иначе после «Очистить» анимации не находятся повторно
      _reportedSvgContainers.clear();
      _reportedFingerprints.clear();
      tryRegistry();
      scanDomForLottieSvg();
    }
  });

  // Запускаем несколько раз: сразу, после DOMContentLoaded и после load
  // (иконки могут грузиться лениво при скролле)
  setTimeout(scanDomForLottieSvg, 200);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(scanDomForLottieSvg, 400); });
  }
  window.addEventListener('load', function () {
    setTimeout(scanDomForLottieSvg, 600);
    // Повторные проверки через 2 и 5 секунд — для lazy-инициализации lottie
    setTimeout(function () { tryRegistry(); scanDomForLottieSvg(); }, 2000);
    setTimeout(function () { tryRegistry(); scanDomForLottieSvg(); }, 5000);
  });

  // Повторное сканирование при скролле — для lazy-loaded иконок
  var _scrollScanTimer = null;
  window.addEventListener('scroll', function () {
    clearTimeout(_scrollScanTimer);
    _scrollScanTimer = setTimeout(scanDomForLottieSvg, 400);
  }, { passive: true });

  // --- MutationObserver для web-компонентов ---
  var _observedComponents = new WeakSet();
  var _componentObservers = new WeakMap(); // node → MutationObserver для корректного disconnect

  function observeWebComponent(node) {
    var tag = node.tagName && node.tagName.toLowerCase();
    if (tag !== 'dotlottie-player' && tag !== 'lottie-player' && tag !== 'lottie-animation') return;
    if (_observedComponents.has(node)) return;
    _observedComponents.add(node);
    // lottie-animation использует атрибут path вместо src
    var src = node.getAttribute('src') || node.getAttribute('path');
    if (src) fetchAndEmit(src, node, 'webcomponent');
    var obs = new MutationObserver(function () {
      var newSrc = node.getAttribute('src') || node.getAttribute('path');
      if (newSrc) fetchAndEmit(newSrc, node, 'webcomponent');
    });
    obs.observe(node, { attributes: true, attributeFilter: ['src', 'path'] });
    _componentObservers.set(node, obs);
  }

  function disconnectWebComponent(node) {
    var obs = _componentObservers.get(node);
    if (!obs) return;
    obs.disconnect();
    _componentObservers.delete(node);
    _observedComponents.delete(node); // разрешает повторное наблюдение при re-insert
  }

  // MutationObserver для lazy-loaded SVG (новые иконки при скролле)
  var _svgScanTimer = null;
  var domObserver = new MutationObserver(function (mutations) {
    var hasSvg = false;
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        observeWebComponent(node);
        if (node.querySelectorAll) {
          node.querySelectorAll('dotlottie-player,lottie-player,lottie-animation').forEach(observeWebComponent);
          if (node.querySelectorAll('svg').length > 0 || node.tagName === 'svg') {
            hasSvg = true;
          }
        }
      });
      // Отключаем наблюдатели удалённых компонентов — предотвращаем утечку памяти
      mutation.removedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        disconnectWebComponent(node);
        if (node.querySelectorAll) {
          node.querySelectorAll('dotlottie-player,lottie-player,lottie-animation').forEach(disconnectWebComponent);
        }
      });
    });
    if (hasSvg) {
      clearTimeout(_svgScanTimer);
      _svgScanTimer = setTimeout(scanDomForLottieSvg, 300);
    }
  });

  var root = document.documentElement || document.body;
  if (root) {
    domObserver.observe(root, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      domObserver.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  // --- dotLottie ZIP-парсер ---
  function extractDotLottie(buffer, container, source) {
    var bytes = new Uint8Array(buffer);
    var SIG = [0x50, 0x4b, 0x03, 0x04];

    for (var i = 0; i < bytes.length - 30; i++) {
      if (bytes[i] !== SIG[0] || bytes[i+1] !== SIG[1] ||
          bytes[i+2] !== SIG[2] || bytes[i+3] !== SIG[3]) continue;

      var compression = bytes[i+8]  | (bytes[i+9]  << 8);
      var compSize    = bytes[i+18] | (bytes[i+19] << 8) | (bytes[i+20] << 16) | (bytes[i+21] << 24);
      var fnLen       = bytes[i+26] | (bytes[i+27] << 8);
      var extraLen    = bytes[i+28] | (bytes[i+29] << 8);
      var filename    = '';
      try { filename = new TextDecoder().decode(bytes.slice(i+30, i+30+fnLen)); } catch (e) {}
      var dataStart   = i + 30 + fnLen + extraLen;

      if (filename.startsWith('animations/') && filename.endsWith('.json')) {
        var entry = bytes.slice(dataStart, dataStart + compSize);
        if (compression === 0) {
          try {
            tryEmitJson(new TextDecoder().decode(entry), 'dotlottie://' + filename, source, container);
          } catch (e) {}
        } else if (compression === 8 && typeof DecompressionStream !== 'undefined') {
          (function (data, fname) {
            try {
              var ds = new DecompressionStream('deflate-raw');
              var writer = ds.writable.getWriter();
              var reader = ds.readable.getReader();
              var chunks = [];
              writer.write(data);
              writer.close();
              function read() {
                reader.read().then(function (r) {
                  if (r.done) {
                    var merged = new Uint8Array(chunks.reduce(function (a, c) { return a + c.length; }, 0));
                    var off = 0;
                    chunks.forEach(function (c) { merged.set(c, off); off += c.length; });
                    try { tryEmitJson(new TextDecoder().decode(merged), 'dotlottie://' + fname, source, container); } catch (e) {}
                  } else { chunks.push(r.value); read(); }
                }).catch(function () {});
              }
              read();
            } catch (e) {}
          })(entry, filename);
        }
      }

      i = dataStart + compSize - 1;
    }
  }

})();
