/**
 * popup.js — логика всплывающего окна расширения.
 */
(function () {
  'use strict';

  var currentTabId = null;
  var thumbInstances = []; // lottie-экземпляры превью для корректного destroy при обновлении
  var _refreshTimer = null; // дебаунс для ANIMATIONS_UPDATED — предотвращает конкурентные render()

  // ── Lottie-анимации в UI ──────────────────────────────────────────────────
  function initUIAnimations() {
    var motor = document.getElementById('header-motor');
    if (motor) lottie.loadAnimation({ container: motor, renderer: 'svg', loop: true, autoplay: true, animationData: LDA_MOTOR_DATA });
    var lupa = document.getElementById('empty-lupa');
    if (lupa) lottie.loadAnimation({ container: lupa, renderer: 'svg', loop: true, autoplay: true, animationData: LDA_LUPA_DATA });
  }

  // Открыть ссылку автора через chrome.tabs (target="_blank" в popup не работает)
  var authorLink = document.getElementById('author-link');
  if (authorLink) {
    authorLink.addEventListener('click', function (e) {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://t.me/onegog_design' });
    });
  }

  initUIAnimations();

  // ── Получить активную вкладку ─────────────────────────────────────────────
  function getCurrentTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      cb(tabs && tabs[0] ? tabs[0] : null);
    });
  }

  // ── Загрузить список анимаций для вкладки ─────────────────────────────────
  function loadAnimations(tabId, cb) {
    chrome.runtime.sendMessage({ type: 'GET_ANIMATIONS', tabId: tabId }, function (list) {
      cb(chrome.runtime.lastError ? [] : (list || []));
    });
  }

  // ── Экранирование HTML ────────────────────────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Загрузить данные анимации и отрисовать превью в thumb ────────────────
  function loadThumbPreview(thumbEl, animationId) {
    chrome.runtime.sendMessage(
      { type: 'GET_ANIMATION_DATA', animationId: animationId },
      function (data) {
        if (chrome.runtime.lastError || !data) return;
        if (!thumbEl.isConnected) return; // карточка уже удалена (popup обновился быстрее)
        try {
          // Показываем первый кадр, воспроизводим при наведении
          var animInstance = lottie.loadAnimation({
            container: thumbEl,
            renderer: 'svg',
            loop: true,
            autoplay: false,
            animationData: data,
          });
          thumbInstances.push(animInstance);
          animInstance.goToAndStop(0, true);

          // Hover — играть / пауза
          thumbEl.addEventListener('mouseenter', function () {
            animInstance.play();
          });
          thumbEl.addEventListener('mouseleave', function () {
            animInstance.goToAndStop(0, true);
          });
        } catch (e) {}
      }
    );
  }

  // ── Создать карточку анимации ─────────────────────────────────────────────
  function buildCard(anim, tabId) {
    var card = document.createElement('div');
    card.className = 'anim-card';
    card.dataset.animId = anim.id;

    var sizeLabel   = anim.width && anim.height ? (anim.width + '×' + anim.height) : '?×?';
    var fpsLabel    = anim.frameRate ? (anim.frameRate + ' fps') : '';
    var durLabel    = anim.duration  ? (anim.duration + 's')     : '';
    var layersLabel = anim.layers    ? (anim.layers + ' слоёв')  : '';

    card.innerHTML =
      '<div class="anim-thumb" title="Наведите для предпросмотра"></div>' +
      '<div class="anim-info">' +
        '<div class="anim-name" title="' + esc(anim.name) + '">' + esc(anim.name) + '</div>' +
        '<div class="anim-tags">' +
          '<span class="tag source">' + esc(anim.source) + '</span>' +
          (sizeLabel   ? '<span class="tag">' + esc(sizeLabel)   + '</span>' : '') +
          (layersLabel ? '<span class="tag">' + esc(layersLabel) + '</span>' : '') +
          (fpsLabel    ? '<span class="tag">' + esc(fpsLabel)    + '</span>' : '') +
          (durLabel    ? '<span class="tag">' + esc(durLabel)    + '</span>' : '') +
        '</div>' +
        '<div class="btn-row">' +
          (anim.domOnly
            ? '<button class="btn-dl btn-nodata" disabled title="JSON недоступен — анимация встроена в код страницы">⚠ Встроена в JS</button>'
            : '<button class="btn-dl" data-id="' + esc(anim.id) + '">↓ JSON</button>') +
          (anim.containerSelector
            ? '<button class="btn-hl" data-id="' + esc(anim.id) + '">👁 Найти</button>'
            : '') +
        '</div>' +
      '</div>';

    // Загрузить lottie-превью в thumb (только если есть реальные данные)
    var thumbEl = card.querySelector('.anim-thumb');
    if (anim.domOnly) {
      thumbEl.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px;opacity:0.4">⚠</div>';
    } else {
      loadThumbPreview(thumbEl, anim.id);
    }

    // Скачать (только для не-domOnly карточек)
    var dlBtn = card.querySelector('.btn-dl');
    if (dlBtn && !dlBtn.disabled) {
      dlBtn.addEventListener('click', function () {
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_ANIMATION',
          animationId: anim.id,
          tabId: tabId,
        });
        dlBtn.textContent = '✓ Скачано';
        dlBtn.style.background = '#16a34a';
        setTimeout(function () {
          if (!dlBtn.isConnected) return; // карточка могла быть удалена при refresh
          dlBtn.textContent = '↓ JSON';
          dlBtn.style.background = '';
        }, 2000);
      });
    }

    // Подсветить на странице
    var hlBtn = card.querySelector('.btn-hl');
    if (hlBtn) {
      hlBtn.addEventListener('click', function () {
        chrome.tabs.sendMessage(tabId, {
          type: 'HIGHLIGHT_ANIMATION',
          animationId: anim.id,
        });
      });
    }

    return card;
  }

  // ── Отрисовка UI ─────────────────────────────────────────────────────────
  function render(animations, tabId) {
    var list  = document.getElementById('list');
    var empty = document.getElementById('empty');
    var count = document.getElementById('count');
    var btnAll = document.getElementById('btn-download-all');

    // Уничтожаем lottie-экземпляры превью перед удалением карточек
    thumbInstances.forEach(function (inst) { try { inst.destroy(); } catch (e) {} });
    thumbInstances = [];

    var oldCards = list.querySelectorAll('.anim-card');
    oldCards.forEach(function (c) { c.remove(); });

    var n = animations.length;
    var downloadable = animations.filter(function (a) { return !a.domOnly; }).length;
    count.textContent = n + ' ' + plural(n, 'анимация', 'анимации', 'анимаций');
    btnAll.disabled = downloadable === 0; // неактивна если нечего скачивать (пусто или все domOnly)

    if (n === 0) {
      empty.style.display = 'flex';
    } else {
      empty.style.display = 'none';
      animations.forEach(function (anim) {
        list.appendChild(buildCard(anim, tabId));
      });
    }
  }

  function plural(n, one, few, many) {
    var mod10  = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  // ── Загрузить и отрисовать ────────────────────────────────────────────────
  function refresh() {
    if (!currentTabId) return;
    loadAnimations(currentTabId, function (list) {
      render(list, currentTabId);
    });
  }

  // ── Скачать все ───────────────────────────────────────────────────────────
  document.getElementById('btn-download-all').addEventListener('click', function () {
    if (!currentTabId) return;
    loadAnimations(currentTabId, function (list) {
      list.forEach(function (anim) {
        if (anim.domOnly) return; // пропускаем DOM-заглушки без реальных данных
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_ANIMATION',
          animationId: anim.id,
          tabId: currentTabId,
        });
      });
    });
  });

  // ── Обновить вручную ──────────────────────────────────────────────────────
  document.getElementById('btn-refresh').addEventListener('click', function () {
    // Сначала запускаем повторное сканирование на странице
    if (currentTabId) {
      chrome.runtime.sendMessage({ type: 'RESCAN', tabId: currentTabId }, function () {
        // После небольшой паузы обновляем список (даём injected.js время найти анимации)
        setTimeout(refresh, 800);
      });
    } else {
      refresh();
    }
  });

  // ── Очистить список ───────────────────────────────────────────────────────
  document.getElementById('btn-clear').addEventListener('click', function () {
    if (!currentTabId) return;
    chrome.runtime.sendMessage({ type: 'CLEAR_ANIMATIONS', tabId: currentTabId }, function () {
      render([], currentTabId);
    });
  });

  // ── Авто-обновление при новых анимациях ──────────────────────────────────
  // Дебаунс 80 мс: несколько быстрых событий сворачиваются в один render()
  chrome.runtime.onMessage.addListener(function (message) {
    if (message.type === 'ANIMATIONS_UPDATED' && message.tabId === currentTabId) {
      clearTimeout(_refreshTimer);
      _refreshTimer = setTimeout(refresh, 80);
    }
  });

  // ── Инициализация ─────────────────────────────────────────────────────────
  getCurrentTab(function (tab) {
    if (!tab) return;
    currentTabId = tab.id;
    refresh();
  });

})();
