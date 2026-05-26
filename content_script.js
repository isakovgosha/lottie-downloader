/**
 * content_script.js — ISOLATED world.
 * Мост между MAIN world (injected.js) и service worker (background.js).
 * Управляет overlay-подсветкой анимаций на странице.
 *
 * injected.js запускается двумя путями (один из них сработает):
 *   1. background.js регистрирует его через chrome.scripting API (MAIN world, document_start)
 *   2. Этот файл вставляет его через <script> тег как резервный вариант
 * Двойного запуска не будет — injected.js содержит guard window.__ldaInjected.
 */
(function () {
  'use strict';

  var EXTENSION_FLAG = '__lottieDownloaderExt__';

  // --- Резервный запуск injected.js через script-тег ---
  // content_script работает в ISOLATED world — window здесь изолирован от MAIN world,
  // поэтому проверить window.__ldaInjected (MAIN world) отсюда невозможно.
  // Гард от двойного запуска находится внутри самого injected.js (window.__ldaInjected).
  (function ensureInjected() {
    try {
      var s = document.createElement('script');
      s.src = chrome.runtime.getURL('injected.js');
      s.onload = function () { s.remove(); };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  // --- Слушаем сообщения от injected.js ---
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || !data[EXTENSION_FLAG]) return;
    if (data.type !== 'LOTTIE_DETECTED') return;

    var payload = {
      animationData: data.animationData,
      source: data.source,
      containerSelector: data.containerSelector || null,
      sourceUrl: data.sourceUrl || null,
    };

    try {
      chrome.runtime.sendMessage(
        { type: 'LOTTIE_DETECTED', payload: payload },
        function (response) {
          if (chrome.runtime.lastError) return;
          if (response && response.animationId) {
            if (payload.containerSelector) {
              createOverlay(payload.containerSelector, response.animationId);
            } else {
              setTimeout(function () {
                var el = findLottieContainerInDOM();
                if (el) createOverlayOnElement(el, response.animationId);
              }, 300);
            }
          }
        }
      );
    } catch (e) {
      // Extension context invalidated — страница открыта до перезапуска расширения, нужен F5
    }
  });

  // --- Поиск контейнера Lottie в DOM ---
  function findLottieContainerInDOM() {
    // 1. Явные Lottie-элементы
    var explicit = document.querySelector(
      '[data-lottie], [data-animation-type="lottie"], ' +
      'dotlottie-player, lottie-player, lottie-animation'
    );
    if (explicit) return explicit;

    // 2. SVG с признаками Lottie-рендерера (содержит <defs> и <g transform>)
    var svgs = document.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      if (svg.querySelector('defs') && svg.querySelector('g[transform]') &&
          svg.parentElement && svg.parentElement.tagName !== 'BODY') {
        // Проверяем, что SVG видим и достаточно большой
        var r = svg.getBoundingClientRect();
        if (r.width > 30 && r.height > 30) {
          return svg.parentElement;
        }
      }
    }

    // 3. Canvas (canvas-рендерер Lottie)
    var canvases = document.querySelectorAll('canvas');
    for (var j = 0; j < canvases.length; j++) {
      var rect = canvases[j].getBoundingClientRect();
      if (rect.width > 30 && rect.height > 30 && canvases[j].parentElement) {
        return canvases[j].parentElement;
      }
    }

    return null;
  }

  // --- Создать overlay по CSS-селектору ---
  function createOverlay(selector, animationId) {
    try {
      var el = document.querySelector(selector);
      if (el) createOverlayOnElement(el, animationId);
    } catch (e) {}
  }

  // --- Создать overlay на конкретном элементе ---
  function createOverlayOnElement(el, animationId) {
    try {
      // Не дублировать
      if (document.querySelector('.lda-overlay[data-animation-id="' + animationId + '"]')) return;

      var position = window.getComputedStyle(el).position;
      var parentModified = (position === 'static');
      if (parentModified) el.style.position = 'relative';

      var overlay = document.createElement('div');
      overlay.className = 'lda-overlay';
      overlay.dataset.animationId = animationId;
      // Флаг на overlay, не на элементе страницы — не загрязняем сторонний DOM
      if (parentModified) overlay.dataset.ldaParentModified = 'true';

      var btn = document.createElement('button');
      btn.className = 'lda-download-btn';
      btn.title = 'Скачать Lottie JSON';
      btn.innerHTML = '&#9660; Lottie';

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        try { chrome.runtime.sendMessage({ type: 'DOWNLOAD_ANIMATION', animationId: animationId }); } catch (e2) {}
        btn.textContent = '✓ Скачано';
        btn.disabled = true;
        setTimeout(function () {
          btn.innerHTML = '&#9660; Lottie';
          btn.disabled = false;
        }, 2000);
      });

      overlay.appendChild(btn);
      el.appendChild(overlay);
    } catch (e) {}
  }

  // --- Удалить все оверлеи со страницы ---
  function removeAllOverlays() {
    document.querySelectorAll('.lda-overlay').forEach(function (overlay) {
      if (overlay.dataset.ldaParentModified && overlay.parentElement) {
        overlay.parentElement.style.position = ''; // восстанавливаем исходный position
      }
      overlay.remove();
    });
  }

  // --- Слушаем команды от popup / background ---
  chrome.runtime.onMessage.addListener(function (message) {
    if (message.type === 'HIGHLIGHT_ANIMATION') {
      flashOverlay(message.animationId);
    }
    if (message.type === 'RESCAN') {
      removeAllOverlays(); // убираем устаревшие оверлеи перед повторным сканированием
      window.postMessage({ __ldaRescan: true }, '*');
    }
    if (message.type === 'CLEAR_ANIMATIONS') {
      removeAllOverlays();
    }
  });

  function flashOverlay(animationId) {
    var overlay = document.querySelector('.lda-overlay[data-animation-id="' + animationId + '"]');
    if (!overlay) return;
    overlay.classList.add('lda-flash');
    overlay.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { overlay.classList.remove('lda-flash'); }, 1200);
  }

})();
