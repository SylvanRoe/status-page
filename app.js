/* Hermes Status — vanilla JS renderer for status.json (schema v1).
   No frameworks, no external requests except same-origin ./status.json. */
(function () {
  'use strict';

  var REFRESH_MS = 60000;
  var HISTORY_DAYS = 90;

  var I18N = {
    en: {
      collecting: 'Collecting data…',
      allOperational: 'All systems operational',
      someDegraded: 'Some systems degraded',
      systemsDown: 'Systems down',
      refreshNote: 'Auto-refreshes every 60s',
      updated: 'Updated',
      components: 'Components',
      statusHistory: 'Uptime history (90 days)',
      incidents: 'Incidents',
      noIncidents: 'No incidents recorded.',
      operational: 'Operational',
      degraded: 'Degraded',
      down: 'Down',
      noData: 'No data',
      unknown: 'Unknown',
      uptime90: '90d uptime',
      avgLatency: 'avg latency',
      lastCheck: 'last check',
      todayChecks: "Today's checks",
      noChecksToday: 'No checks recorded today yet.',
      ongoing: 'Ongoing',
      resolved: 'Resolved',
      major: 'major',
      minor: 'minor',
      affected: 'Affected',
      failedChecks: 'failed checks',
      loadFailed: 'status.json unavailable — collecting data, please check back soon.',
      time: 'Time',
      result: 'Result',
      latency: 'Latency',
      code: 'HTTP',
      ok: 'OK',
      fail: 'FAIL',
      ms: 'ms',
      themeLight: 'Light',
      themeDark: 'Dark'
    },
    zh: {
      collecting: '数据收集中…',
      allOperational: '所有系统正常运行',
      someDegraded: '部分系统降级',
      systemsDown: '系统故障',
      refreshNote: '每 60 秒自动刷新',
      updated: '更新于',
      components: '组件',
      statusHistory: '90 天可用性历史',
      incidents: '事件记录',
      noIncidents: '暂无事件记录。',
      operational: '正常',
      degraded: '降级',
      down: '故障',
      noData: '无数据',
      unknown: '未知',
      uptime90: '90 天可用率',
      avgLatency: '平均延迟',
      lastCheck: '最近探测',
      todayChecks: '今日探测明细',
      noChecksToday: '今日暂无探测记录。',
      ongoing: '进行中',
      resolved: '已恢复',
      major: '严重',
      minor: '轻微',
      affected: '影响组件',
      failedChecks: '失败次数',
      loadFailed: 'status.json 暂不可用——数据收集中，请稍后查看。',
      time: '时间',
      result: '结果',
      latency: '延迟',
      code: 'HTTP',
      ok: '成功',
      fail: '失败',
      ms: '毫秒',
      themeLight: '亮色',
      themeDark: '暗色'
    }
  };

  var lang = localStorage.getItem('status-lang') ||
    ((navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en');
  if (!I18N[lang]) lang = 'en';

  function t(key) { return I18N[lang][key] || I18N.en[key] || key; }

  /* ---------- 明暗主题（与官网同机制：gavinlab-theme-v2 跨站同步，
     data-theme 属性 + 系统偏好跟随至手动切换；图标文案走内置字典） ---------- */
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

  function applyStaticI18n() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = lang === 'zh'
      ? 'Hermes Status — 服务可用性'
      : 'Hermes Status — Service Availability';
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    var btn = document.getElementById('lang-toggle');
    btn.textContent = lang === 'zh' ? 'EN' : '中文';
    syncThemeBtn();
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
    return d.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour12: false });
  }

  function fmtDay(isoDate) {
    var d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d)) return isoDate;
    return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US',
      { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function relTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  function statusClass(st) {
    return st === 'operational' || st === 'degraded' || st === 'down' ? st : 'unknown';
  }

  function compName(c) {
    return lang === 'zh' ? (c.name || c.name_en || c.id) : (c.name_en || c.name || c.id);
  }

  /* ---------- renderers ---------- */

  function renderOverall(data) {
    var el = document.getElementById('overall');
    var dot = document.getElementById('overall-dot');
    var txt = document.getElementById('overall-text');
    var gen = document.getElementById('generated-at');
    el.className = 'overall overall-' + statusClass(data.overall);
    dot.className = 'status-dot dot-' + statusClass(data.overall);
    txt.textContent = data.overall === 'operational' ? t('allOperational')
      : data.overall === 'degraded' ? t('someDegraded')
      : data.overall === 'down' ? t('systemsDown')
      : t('collecting');
    gen.textContent = data.generated_at
      ? t('updated') + ' ' + fmtTime(data.generated_at) + ' (' + relTime(data.generated_at) + ')'
      : '';
  }

  /* lucide chevron-right：固定 12px，stroke currentColor，禁 unicode 字符图标 */
  var CARET_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

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
          '<span>' + t('uptime90') + ' <b>' +
            (typeof c.uptime_90d === 'number' ? c.uptime_90d.toFixed(2) + '%' : '—') + '</b></span>' +
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
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = t('noIncidents');
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
          (resolved ? ' – ' + esc(fmtTime(inc.resolved)) : '') +
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

  document.getElementById('lang-toggle').addEventListener('click', function () {
    lang = lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('status-lang', lang);
    applyStaticI18n();
    load();
  });

  applyStaticI18n();
  initThemeToggle();
  syncThemeBtn();
  load();
  setInterval(load, REFRESH_MS);
})();
