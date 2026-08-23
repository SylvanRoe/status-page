/* Gavin's Lab Status — vanilla JS renderer for status.json (schema v1).
   No frameworks, no external requests except same-origin ./status.json + ./locales/*.json.

   0823-sp-1：明暗主题（gavinlab-theme-v2 跨站同步，data-theme 属性 + 系统偏好跟随至手动切换）。
   0823-sp-2 多语言机制对齐官网（company-site/ui.js 公共组件）：
   ① 语言检测优先级：?lang=xx → localStorage site-lang-v2 → 旧 status-lang（兼容迁移）→ navigator.languages → zh
   ② langBtn+langMenu 12 语切换：点击 .lang-opt → 写 site-lang-v2 → URL ?lang= 同步（replaceState）→ reload
   ③ locales/*.json 12 语言包 + __I18N_VER 版本号 + site-i18n-cache-v{VER}-{LANG} 缓存 + .i18n-pending 防闪烁门控
   ④ html lang/dir 同步（ar 用 rtl）
   ⑤ JS 动态文案全量走 T(key)，禁硬编码中英文（组件名 name_en/name 为数据字段保留）
   0823-sp-3b：数据积累期诚实展示（组件 uptime 按 data_days 标注 N 天 / 全组件 <7 天横幅「数据采集中」/ 热力图 st-none 保留）
   + 品牌 Gavin's Lab（全站品牌替换为 Gavin's Lab Status，__I18N_VER 2→3；og:url/canonical/footer 域名 hermes.cc.cd 保留） */
(function () {
  'use strict';

  var REFRESH_MS = 60000;
  var HISTORY_DAYS = 90;
  var I18N_VER = window.__I18N_VER || 1;

  /* 内置兜底 dict（zh/en 全量；语言包 fetch 失败时保底，永不显示裸 key / undefined）。
     与 locales/*.json 同键集 —— 改键值须同步 12 语言包并递增 __I18N_VER（多语言铁律）。 */
  var I18N = {
    zh: {
      collecting: '数据收集中…', allOperational: '所有系统正常运行', someDegraded: '部分系统降级',
      systemsDown: '系统故障', refreshNote: '每 60 秒自动刷新', updated: '更新于',
      components: '组件', statusHistory: '90 天可用性历史', incidents: '事件记录',
      noIncidents: '暂无事件记录。', operational: '正常', degraded: '降级', down: '故障',
      noData: '无数据', unknown: '未知', uptime90: '90 天可用率', avgLatency: '平均延迟',
      lastCheck: '最近探测', todayChecks: '今日探测明细', noChecksToday: '今日暂无探测记录。',
      ongoing: '进行中', resolved: '已恢复', major: '严重', minor: '轻微', affected: '影响组件',
      failedChecks: '失败次数',
      loadFailed: 'status.json 暂不可用——数据收集中，请稍后查看。',
      time: '时间', result: '结果', latency: '延迟', code: 'HTTP', ok: '成功', fail: '失败', ms: '毫秒',
      langAria: '选择语言', metaTitle: 'Gavin\'s Lab Status — 服务可用性',
      metaDescription: 'Gavin\'s Lab 公开服务的实时可用性与 90 天运行历史：官网、OPC API、MRD 面板、博客与 API 网关。',
      timeS: '秒', timeM: '分', timeH: '时', timeD: '天',
      uptimeBasedOn: '基于 {n} 天', statusHistoryCollected: '（已采集 {n} 天）',
      themeLight: '亮色', themeDark: '暗色'
    },
    en: {
      collecting: 'Collecting data…', allOperational: 'All systems operational', someDegraded: 'Some systems degraded',
      systemsDown: 'Systems down', refreshNote: 'Auto-refreshes every 60s', updated: 'Updated',
      components: 'Components', statusHistory: 'Uptime history (90 days)', incidents: 'Incidents',
      noIncidents: 'No incidents recorded.', operational: 'Operational', degraded: 'Degraded', down: 'Down',
      noData: 'No data', unknown: 'Unknown', uptime90: '90d uptime', avgLatency: 'avg latency',
      lastCheck: 'last check', todayChecks: "Today's checks", noChecksToday: 'No checks recorded today yet.',
      ongoing: 'Ongoing', resolved: 'Resolved', major: 'major', minor: 'minor', affected: 'Affected',
      failedChecks: 'failed checks',
      loadFailed: 'status.json unavailable — collecting data, please check back soon.',
      time: 'Time', result: 'Result', latency: 'Latency', code: 'HTTP', ok: 'OK', fail: 'FAIL', ms: 'ms',
      langAria: 'Select language', metaTitle: 'Gavin\'s Lab Status — Service Availability',
      metaDescription: 'Real-time availability and 90-day uptime history for Gavin\'s Lab public services: website, OPC API, MRD dashboard, blog and API gateway.',
      timeS: 's', timeM: 'm', timeH: 'h', timeD: 'd',
      uptimeBasedOn: 'based on {n} days', statusHistoryCollected: '(collected {n} days)',
      themeLight: 'Light', themeDark: 'Dark'
    }
  };

  var LANG_MAP = { zh: 1, en: 1, ja: 1, ko: 1, fr: 1, de: 1, ar: 1, ru: 1, es: 1, tr: 1, pl: 1, pt: 1 };
  var LANG_NAMES = { zh: '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch', ar: 'العربية', ru: 'Русский', es: 'Español', tr: 'Türkçe', pl: 'Polski', pt: 'Português' };
  var LOCALE_MAP = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', fr: 'fr-FR', de: 'de-DE', ar: 'ar', ru: 'ru-RU', es: 'es-ES', tr: 'tr-TR', pl: 'pl-PL', pt: 'pt-PT' };

  /* 语言检测（与 index.html head bootstrap 同优先级；__i18nLang 由 head 首帧同步设置，
     此函数兜底 —— test 环境无 head bootstrap 时也能按 localStorage/navigator 正确判定） */
  function detectLang() {
    try { if (window.__i18nLang && LANG_MAP[window.__i18nLang]) return window.__i18nLang; } catch (e) {}
    try {
      if (typeof location !== 'undefined') {
        var qm = location.search.match(/[?&]lang=([a-z]{2})/);
        if (qm && LANG_MAP[qm[1]]) return qm[1];
      }
    } catch (e) {}
    try { var sv = localStorage.getItem('site-lang-v2'); if (sv && LANG_MAP[sv]) return sv; } catch (e) {}
    try { var old = localStorage.getItem('status-lang'); if (old && LANG_MAP[old]) { try { localStorage.setItem('site-lang-v2', old); } catch (e5) {} return old; } } catch (e) {}
    try {
      var al = (navigator.languages || [navigator.language || 'zh']).map(function (x) {
        return String(x).toLowerCase().split('-')[0];
      });
      for (var i = 0; i < al.length; i++) { if (LANG_MAP[al[i]]) return al[i]; }
    } catch (e) {}
    return 'zh';
  }

  var lang = detectLang();
  var DICT = null; // 当前语言包（异步加载后赋值；null = 用内置兜底）

  /* 翻译函数：语言包 → 内置兜底 → 原样 key（永不 undefined） */
  function t(key) {
    if (DICT && Object.prototype.hasOwnProperty.call(DICT, key)) return DICT[key];
    if (I18N[lang] && Object.prototype.hasOwnProperty.call(I18N[lang], key)) return I18N[lang][key];
    if (I18N.en && Object.prototype.hasOwnProperty.call(I18N.en, key)) return I18N.en[key];
    return key;
  }
  window.T = t; // 对外暴露（与官网一致，公共组件取词入口）

  function locale() { return LOCALE_MAP[lang] || lang; }

  /* ---------- 明暗主题（与官网同机制：gavinlab-theme-v2 跨站同步，
     data-theme 属性 + 系统偏好跟随至手动切换；图标文案走 t() 语言包） ---------- */
  var THEME_KEY = 'gavinlab-theme-v2';
  var themeManual = false;
  try { themeManual = !!localStorage.getItem(THEME_KEY); } catch (e) {}

  function themeIcon(isDark) {
    // lucide moon / sun，固定 14px，stroke currentColor
    return isDark
      ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function syncThemeBtn() {
    var btn = document.getElementById('themeBtn');
    if (!btn) return;
    var dark = currentTheme() === 'dark';
    // 暗色下显示「亮色」（点击回到亮色），与官网 themeBtn 行为一致
    btn.innerHTML = themeIcon(!dark) +
      '<span class="theme-btn-txt">' + esc(t(dark ? 'themeLight' : 'themeDark')) + '</span>';
    btn.setAttribute('aria-label', t(dark ? 'themeLight' : 'themeDark'));
  }

  function initThemeToggle() {
    var btn = document.getElementById('themeBtn');
    if (!btn) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSysChange = function (e) {
      if (!themeManual) { applyTheme(e.matches ? 'dark' : 'light'); syncThemeBtn(); }
    };
    if (mq.addEventListener) mq.addEventListener('change', onSysChange);
    else if (mq.addListener) mq.addListener(onSysChange);
    btn.addEventListener('click', function () {
      themeManual = true;
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      syncThemeBtn();
    });
  }

  /* ---------- 静态 i18n 应用（title/meta/data-i18n/data-i18n-aria/langCur/html lang/dir） ---------- */
  function applyStaticI18n() {
    var de = document.documentElement;
    if (de) {
      if (de.setAttribute) {
        de.setAttribute('lang', lang);
        de.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      } else {
        de.lang = lang; de.dir = lang === 'ar' ? 'rtl' : 'ltr';
      }
    }
    document.title = t('metaTitle');
    if (document.querySelector) {
      var m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', t('metaDescription'));
      var og = document.querySelector('meta[property="og:description"]');
      if (og) og.setAttribute('content', t('metaDescription'));
      var ogt = document.querySelector('meta[property="og:title"]');
      if (ogt) ogt.setAttribute('content', t('metaTitle'));
    }
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    var aria = document.querySelectorAll('[data-i18n-aria]');
    for (var j = 0; j < aria.length; j++) {
      aria[j].setAttribute('aria-label', t(aria[j].getAttribute('data-i18n-aria')));
    }
    var cur = document.getElementById('langCur');
    if (cur) cur.textContent = LANG_NAMES[lang] || lang;
    syncThemeBtn(); // 主题按钮文案随语言包刷新
  }

  /* ---------- 语言包加载（缓存命中同步应用零闪烁；fetch 失败回退 zh → 内置兜底） ---------- */
  function applyDict(dict) {
    DICT = dict && typeof dict === 'object' ? dict : null;
    var de = document.documentElement;
    if (de && de.classList && de.classList.remove) de.classList.remove('i18n-pending');
    applyStaticI18n();
    load(); // 语言包就绪后再拉 status.json，避免渲染时文案缺失
  }

  function loadI18n() {
    var KEY = 'site-i18n-cache-v' + I18N_VER + '-' + lang;
    if (window.__i18nCachedDict) { // head bootstrap 已命中缓存 → 同步应用
      try {
        applyDict(window.__i18nCachedDict);
        return;
      } catch (e) {
        window.__i18nCachedDict = null;
        try { localStorage.removeItem(KEY); } catch (e2) {}
      }
    }
    if (lang === 'zh') { // zh 内置兜底即全量，无需网络请求
      applyDict(null);
      return;
    }
    fetch('locales/' + lang + '.json?v=' + I18N_VER)
      .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
      .then(function (dict) {
        applyDict(dict);
        try { localStorage.setItem(KEY, JSON.stringify({ lang: lang, ver: I18N_VER, dict: dict })); } catch (e) {}
      })
      .catch(function () {
        var de = document.documentElement;
        if (de && de.classList && de.classList.remove) de.classList.remove('i18n-pending');
        return fetch('locales/zh.json?v=' + I18N_VER)
          .then(function (r) { return r.json(); })
          .then(applyDict)
          .catch(function () { applyDict(null); });
      });
  }

  /* ---------- langBtn + langMenu（官网同构交互：点击外部关闭、aria、active 高亮、?lang= 同步） ---------- */
  function initLang() {
    var langBtn = document.getElementById('langBtn');
    var langMenu = document.getElementById('langMenu');
    if (!langBtn || !langMenu) return;
    // aria-expanded 动态管理（与 .lang-menu.open 同步：open=true / close=false，验收 A1）
    function syncLangAria() {
      langBtn.setAttribute('aria-expanded', langMenu.classList.contains('open') ? 'true' : 'false');
    }
    syncLangAria(); // 初始同步（菜单默认关闭 → false，与 index.html 静态初始值一致）
    langBtn.addEventListener('click', function (e) { e.stopPropagation(); langMenu.classList.toggle('open'); syncLangAria(); });
    if (document.addEventListener) {
      document.addEventListener('click', function () { langMenu.classList.remove('open'); syncLangAria(); });
    }
    langMenu.addEventListener('click', function (e) { e.stopPropagation(); });
    var opts = langMenu.querySelectorAll ? langMenu.querySelectorAll('.lang-opt') : [];
    for (var i = 0; i < opts.length; i++) {
      (function (b) {
        b.classList.toggle('active', b.getAttribute('data-lang') === lang);
        b.addEventListener('click', function () {
          var l = b.getAttribute('data-lang');
          if (l === lang) { langMenu.classList.remove('open'); syncLangAria(); return; }
          try { localStorage.setItem('site-lang-v2', l); } catch (e) {}
          try { // ?lang= URL 同步（replaceState 保留其它参数），分享链接携带语言、刷新保持
            if (typeof location !== 'undefined' && history.replaceState) {
              var u = new URL(location.href);
              u.searchParams.set('lang', l);
              history.replaceState(null, '', u.toString());
            }
          } catch (e) {}
          location.reload();
        });
      })(opts[i]);
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    return d.toLocaleString(locale(), { hour12: false });
  }

  function fmtDay(isoDate) {
    var d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d)) return isoDate;
    return d.toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function relTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (s < 60) return s + t('timeS');
    if (s < 3600) return Math.floor(s / 60) + t('timeM');
    if (s < 86400) return Math.floor(s / 3600) + t('timeH');
    return Math.floor(s / 86400) + t('timeD');
  }

  function statusClass(st) {
    return st === 'operational' || st === 'degraded' || st === 'down' ? st : 'unknown';
  }

  /* 组件名：数据字段（name/name_en），非文案 —— zh 用 name，其余语言用 name_en（保留原逻辑） */
  function compName(c) {
    return lang === 'zh' ? (c.name || c.name_en || c.id) : (c.name_en || c.name || c.id);
  }

  /* ---------- renderers（动态文案全量走 t()，禁硬编码中英文） ---------- */

  /* 数据积累期判定（0823-sp-3b）：所有组件 data_days 均 < 7（含 0）→ 数据采集中；
     任一组件 data_days >= 7 或数据完全无 data_days 字段（老数据兼容）→ 按 probe 真实 overall。
     判定放页面侧，probe 的 overall 字段语义（真实服务状态）不改。 */
  function isCollecting(data) {
    var comps = data.components || [];
    var anyDD = comps.some(function (c) { return typeof c.data_days === 'number'; });
    if (!anyDD) return false;
    return comps.every(function (c) {
      return (typeof c.data_days === 'number' ? c.data_days : 0) < 7;
    });
  }

  function renderOverall(data) {
    var el = document.getElementById('overall');
    var dot = document.getElementById('overall-dot');
    var txt = document.getElementById('overall-text');
    var gen = document.getElementById('generated-at');
    var collecting = isCollecting(data);
    var st = collecting ? 'unknown' : statusClass(data.overall);
    el.className = 'overall overall-' + st;
    dot.className = 'status-dot dot-' + st;
    txt.textContent = collecting ? t('collecting')
      : data.overall === 'operational' ? t('allOperational')
      : data.overall === 'degraded' ? t('someDegraded')
      : data.overall === 'down' ? t('systemsDown')
      : t('collecting');
    gen.textContent = data.generated_at
      ? t('updated') + ' ' + fmtTime(data.generated_at) + ' (' + relTime(data.generated_at) + ')'
      : '';
  }

  /* lucide chevron-right：固定 12px，stroke currentColor，禁 unicode 字符图标 */
  var CARET_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

  /* 组件 uptime 值（0823-sp-3b 诚实展示数据积累期）：
     data_days >= 90 → 常规「99.98%」；0 < data_days < 90 → 「99.98% · 基于 N 天」（100% 也带标注）；
     data_days == 0 或 uptime_90d 非 number（含 null）→ 「—」（无数据不虚报 %）。 */
  function uptimeLabel(c) {
    var dd = typeof c.data_days === 'number' ? c.data_days : 0;
    if (dd <= 0 || typeof c.uptime_90d !== 'number') return '—';
    var pct = c.uptime_90d.toFixed(2) + '%';
    if (dd >= 90) return pct;
    var note = t('uptimeBasedOn').replace('{n}', dd);
    if (lang === 'en' && dd === 1) note = note.replace('days', 'day');
    return pct + ' · ' + note;
  }

  function renderComponents(data) {
    var list = document.getElementById('component-list');
    list.innerHTML = '';
    (data.components || []).forEach(function (c) {
      var wrap = document.createElement('div');
      wrap.className = 'component';

      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'component-row';
      row.setAttribute('aria-expanded', 'false');

      var st = statusClass(c.status);
      row.innerHTML =
        '<span class="component-name"><span class="caret">' + CARET_SVG + '</span>' + esc(compName(c)) + '</span>' +
        '<span class="badge badge-' + st + '">' +
          '<span class="status-dot dot-' + st + '"></span>' + esc(t(st)) + '</span>' +
        '<span class="component-metrics">' +
          '<span>' + t('uptime90') + ' <b>' + esc(uptimeLabel(c)) + '</b></span>' +
          '<span>' + t('avgLatency') + ' <b>' +
            (typeof c.latency_avg_ms === 'number' ? Math.round(c.latency_avg_ms) + ' ' + t('ms') : '—') + '</b></span>' +
        '</span>';

      var detail = document.createElement('div');
      detail.className = 'component-detail';
      var checks = Array.isArray(c.today_checks) ? c.today_checks.slice() : [];
      checks.sort(function (a, b) { return String(b.t).localeCompare(String(a.t)); });
      var html = '<div>' + t('todayChecks') +
        (c.last_check ? ' · ' + t('lastCheck') + ' ' + esc(fmtTime(c.last_check)) : '') + '</div>';
      if (!checks.length) {
        html += '<div style="margin-top:6px">' + t('noChecksToday') + '</div>';
      } else {
        html += '<table><thead><tr><th>' + t('time') + '</th><th>' + t('result') +
          '</th><th>' + t('latency') + '</th><th>' + t('code') + '</th></tr></thead><tbody>';
        checks.forEach(function (ch) {
          html += '<tr><td>' + esc(fmtTime(ch.t)) + '</td>' +
            '<td class="' + (ch.ok ? 'check-ok' : 'check-bad') + '">' + (ch.ok ? t('ok') : t('fail')) + '</td>' +
            '<td>' + (typeof ch.latency_ms === 'number' ? esc(Math.round(ch.latency_ms) + ' ' + t('ms')) : '—') + '</td>' +
            '<td>' + (ch.code != null ? esc(ch.code) : '—') + '</td></tr>';
        });
        html += '</tbody></table>';
      }
      detail.innerHTML = html;

      row.addEventListener('click', function () {
        var open = wrap.classList.toggle('open');
        row.setAttribute('aria-expanded', open ? 'true' : 'false');
      });

      wrap.appendChild(row);
      wrap.appendChild(detail);
      list.appendChild(wrap);
    });
  }

  function renderHistory(data) {
    var root = document.getElementById('history');
    root.innerHTML = '';
    var history = data.history_90d || {};
    // 0823-sp-3b 区块标题副注（可选增强）：所有组件积累期一致且 >0 → 「90 天可用性历史（已采集 N 天）」
    var h2 = document.querySelector('[data-i18n="statusHistory"]');
    if (h2) {
      var dds = [];
      (data.components || []).forEach(function (c) {
        if (typeof c.data_days === 'number') dds.push(c.data_days);
      });
      if (dds.length && dds.every(function (v) { return v > 0 && v === dds[0]; })) {
        h2.textContent = t('statusHistory') + ' ' + t('statusHistoryCollected').replace('{n}', dds[0]);
      }
    }

    // Anchor the 90-day window on generated_at so the page shares the probe's clock.
    var end = new Date();
    if (data.generated_at) {
      var g = new Date(data.generated_at);
      if (!isNaN(g)) end = g;
    }
    var days = [];
    for (var i = HISTORY_DAYS - 1; i >= 0; i--) {
      var d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - i));
      days.push(d.toISOString().slice(0, 10));
    }

    (data.components || []).forEach(function (c) {
      var rowEl = document.createElement('div');
      rowEl.className = 'history-row';
      var label = document.createElement('div');
      label.className = 'history-label';
      label.textContent = compName(c);
      label.title = compName(c);
      var cells = document.createElement('div');
      cells.className = 'history-cells';
      days.forEach(function (day, idx) {
        var st = history[day] && history[day][c.id];
        if (!st && idx === days.length - 1) st = c.status; // today fallback
        var cls = st === 'operational' ? 'st-operational'
          : st === 'degraded' ? 'st-degraded'
          : st === 'down' ? 'st-down' : 'st-none';
        var cell = document.createElement('div');
        cell.className = 'cell ' + cls;
        cell.title = fmtDay(day) + ' — ' + (st ? t(st) : t('noData'));
        cells.appendChild(cell);
      });
      rowEl.appendChild(label);
      rowEl.appendChild(cells);
      root.appendChild(rowEl);
    });
  }

  function renderIncidents(data) {
    var list = document.getElementById('incident-list');
    list.innerHTML = '';
    var incidents = Array.isArray(data.incidents) ? data.incidents.slice() : [];
    incidents.sort(function (a, b) { return String(b.started).localeCompare(String(a.started)); });
    if (!incidents.length) {
      // 空态强化（0823-sp-3b）：图标 + 文案，明显是「有设计的占位」而非「加载失败」（Gavin 曾反馈空置）
      var empty = document.createElement('div');
      empty.className = 'empty-state empty-incidents';
      empty.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>' +
        '<span>' + esc(t('noIncidents')) + '</span>';
      list.appendChild(empty);
      return;
    }
    var nameById = {};
    (data.components || []).forEach(function (c) { nameById[c.id] = compName(c); });
    incidents.forEach(function (inc) {
      var el = document.createElement('div');
      el.className = 'incident sev-' + (inc.severity === 'minor' ? 'minor' : 'major');
      var affected = (inc.affected || []).map(function (id) { return nameById[id] || id; }).join(', ');
      var resolved = !!inc.resolved;
      el.innerHTML =
        '<div class="incident-head">' +
          '<span class="incident-id">' + esc(inc.id || '') + '</span>' +
          '<span class="incident-summary">' + esc(inc.summary || '') + '</span>' +
          '<span class="incident-state ' + (resolved ? 'state-resolved' : 'state-ongoing') + '">' +
            (resolved ? t('resolved') : t('ongoing')) + '</span>' +
        '</div>' +
        '<div class="incident-meta">' +
          esc(fmtTime(inc.started)) +
          (resolved ? ' → ' + esc(fmtTime(inc.resolved)) : '') +
          ' · ' + t('affected') + ': ' + esc(affected || '—') +
          ' · ' + esc(t(inc.severity === 'minor' ? 'minor' : 'major')) +
          (typeof inc.failed_checks === 'number' ? ' · ' + inc.failed_checks + ' ' + t('failedChecks') : '') +
        '</div>';
      list.appendChild(el);
    });
  }

  function renderAll(data) {
    renderOverall(data);
    renderComponents(data);
    renderHistory(data);
    renderIncidents(data);
  }

  function renderDegraded() {
    // status.json missing / unparsable: graceful placeholder, never a blank page.
    var data = { overall: null, generated_at: null, components: [], incidents: [] };
    renderAll(data);
    ['component-list', 'history', 'incident-list'].forEach(function (id) {
      var el = document.getElementById(id);
      el.innerHTML = '';
      var d = document.createElement('div');
      d.className = 'empty-state';
      d.textContent = t('loadFailed');
      el.appendChild(d);
    });
  }

  function load() {
    fetch('./status.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { renderAll(data || {}); })
      .catch(function () { renderDegraded(); });
  }

  /* ---------- boot ---------- */
  applyStaticI18n();
  initLang();
  initThemeToggle();
  loadI18n(); // 内部 applyDict → load()；语言包失败也会走兜底渲染
  setInterval(load, REFRESH_MS);
})();
