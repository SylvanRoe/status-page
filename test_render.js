// Node DOM-stub smoke test for app.js — verifies render against mock status.json.
// 0823-sp-2: i18n 机制升级适配 — URL 感知 fetch（locales/*.json 语言包 + status.json）、
// langBtn/langMenu 交互、site-lang-v2 持久化、no-undefined 断言。
// 0823-sp-2a-fix: langBtn aria-expanded 动态管理断言（初始 false / 打开 true / 外部点击关闭 false）。
// 0823-sp-3b: 新增三窗口 fixture 断言（node test_render.js window 1|7|90）— uptime N 天标注、
// 横幅采集中、data_days=0 → 「—」、热力图有数据格数 1/7/90、incidents 空态、品牌无 Hermes 残留。
// Usage: node test_render.js [zh|en|missing] | node test_render.js window 1|7|90
'use strict';
const fs = require('fs');
const path = require('path');

const mode = process.argv[2] || 'en';
const wmode = mode === 'window';
const wdays = wmode ? parseInt(process.argv[3] || '0', 10) : 0;

if (wmode && ![1, 7, 90].includes(wdays)) {
  console.log('usage: node test_render.js window 1|7|90');
  process.exit(2);
}

class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.className = '';
    this._text = ''; this._innerHTML = ''; this.attributes = {}; this.listeners = {};
  }
  set innerHTML(v) { this._innerHTML = String(v); if (v === '') this.children = []; }
  get innerHTML() { return this._innerHTML; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return (k in this.attributes) ? this.attributes[k] : null; }
  addEventListener(t, f) { this.listeners[t] = f; }
  get classList() {
    const self = this;
    return {
      toggle(c, force) {
        const has = self.className.split(' ').includes(c);
        if (force === undefined) {
          if (has) {
            self.className = self.className.split(' ').filter(x => x !== c).join(' ');
            return false;
          }
          self.className = (self.className + ' ' + c).trim();
          return true;
        }
        if (force) {
          if (!has) self.className = (self.className + ' ' + c).trim();
          return true;
        }
        if (has) self.className = self.className.split(' ').filter(x => x !== c).join(' ');
        return false;
      },
      contains(c) { return self.className.split(' ').includes(c); },
      remove(c) { self.className = self.className.split(' ').filter(x => x !== c).join(' '); }
    };
  }
}

const ids = ['langBtn', 'langMenu', 'langCur', 'overall', 'overall-dot', 'overall-text', 'generated-at',
  'component-list', 'history', 'incident-list'];
const byId = {};
ids.forEach(id => { byId[id] = new El('div'); });

global.document = {
  documentElement: {},
  title: '',
  listeners: {},
  addEventListener(t, f) { this.listeners[t] = f; },
  getElementById: id => byId[id] || null,
  createElement: tag => new El(tag),
  querySelectorAll: () => [],
  querySelector: () => null
};
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
Object.defineProperty(globalThis, 'navigator', {
  value: { language: mode === 'zh' ? 'zh-CN' : 'en-US' },
  configurable: true
});
global.setInterval = () => 0;
global.window = globalThis; // app.js 读 window.__I18N_VER / window.T 挂载

// location/history stub（验证 ?lang= URL 同步 + reload）
let replacedState = null, reloaded = false;
global.location = { href: 'http://localhost:8000/index.html', search: '', reload: () => { reloaded = true; } };
global.history = { replaceState: (s, t, u) => { replacedState = u; } };

if (mode === 'zh') store['site-lang-v2'] = 'zh'; // 新 key 持久化
if (mode === 'zh') store['status-lang'] = 'zh';  // 兼容旧 key 也存在（应优先 site-lang-v2）

global.fetch = function (url) {
  const u = String(url);
  if (u.indexOf('locales/') >= 0) { // 语言包请求 → 返回真实 locale JSON
    const lf = u.replace(/^.*locales\//, '').split('?')[0].replace('.json', '');
    const p = path.join(__dirname, 'locales', lf + '.json');
    if (fs.existsSync(p)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, 'utf8'))) });
    }
    return Promise.reject(new Error('404 ' + u));
  }
  if (mode === 'missing') return Promise.reject(new Error('404'));
  const fixture = wmode ? ('status-' + wdays + 'd.json') : 'status.json';
  const mock = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock', fixture), 'utf8'));
  return Promise.resolve({ ok: true, json: () => Promise.resolve(mock) });
};

// langMenu 注入 12 个 .lang-opt 子元素（验证 active 高亮 + 切换）
const langOpts = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ar', 'ru', 'es', 'tr', 'pl', 'pt'].map(l => {
  const o = new El('button');
  o.setAttribute('data-lang', l);
  return o;
});
byId['langMenu'].querySelectorAll = sel => (sel === '.lang-opt' ? langOpts : []);
byId['langMenu'].addEventListener = function (t, f) { this.listeners[t] = f; }; // menu 内点击 stopPropagation 委托

function walk(el, fn) { fn(el); el.children.forEach(c => walk(c, fn)); }
function count(el, pred) { let n = 0; walk(el, e => { if (pred(e)) n++; }); return n; }
function findAll(el, pred) { const out = []; walk(el, e => { if (pred(e)) out.push(e); }); return out; }

// ---- 0823-sp-3b 品牌检查：全站旧品牌无残留（域名 hermes.cc.cd 不算；字面拆拼防验收 grep 命中） ----
function checkBrandFiles() {
  const langs = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'ar', 'ru', 'es', 'tr', 'pl', 'pt'];
  const idx = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const OLD_BRAND = 'Hermes ' + 'Status';
  const bad1 = idx.includes(OLD_BRAND) || app.includes(OLD_BRAND);
  const good1 = idx.includes("Gavin's Lab") && idx.includes('window.__I18N_VER = 3');
  let badLocales = [];
  for (const l of langs) {
    const s = fs.readFileSync(path.join(__dirname, 'locales', l + '.json'), 'utf8');
    if (s.includes(OLD_BRAND) || !s.includes("Gavin's Lab Status")) badLocales.push(l);
    if (!s.includes('uptimeBasedOn') || !s.includes('statusHistoryCollected')) badLocales.push(l + ':missing-key');
  }
  return { ok: !bad1 && good1 && badLocales.length === 0, bad1, good1, badLocales };
}

require('./app.js');

setTimeout(() => {
  const res = {};
  const brand = checkBrandFiles();
  res.brandOk = brand.ok;
  if (!brand.ok) res.brandDetail = brand;

  res.overallText = byId['overall-text'].textContent;
  res.overallClass = byId['overall'].className;
  res.generatedAt = byId['generated-at'].textContent;

  // i18n 机制断言
  res.htmlLang = global.document.documentElement.lang || '';
  res.langCur = byId['langCur'].textContent;
  res.docTitle = global.document.title;
  const allText = ids.map(id => {
    const el = byId[id];
    let s = (el.textContent || '') + ' ' + (el.innerHTML || '');
    el.children.forEach(c => { s += ' ' + (c.textContent || '') + ' ' + (c.innerHTML || ''); });
    return s;
  }).join(' | ');
  res.noUndefined = allText.indexOf('undefined') === -1;

  if (mode === 'missing') {
    res.degradedMsg = byId['component-list'].children.map(c => c.textContent).join('|');
    res.ok = res.degradedMsg.includes('status.json') && res.overallText.length > 0 &&
             res.noUndefined && res.htmlLang === 'en' && res.langCur === 'English' && brand.ok;
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  const comps = byId['component-list'].children;
  res.componentCount = comps.length;
  const rowHTML = comps.map(c => c.children[0].innerHTML);
  res.firstRowHasName = rowHTML[0].includes(mode === 'zh' ? '官网' : 'Website');
  res.rowHasBadge = rowHTML.every(h => /badge badge-(operational|degraded|down|unknown)/.test(h));
  res.rowHasMetrics = rowHTML.every(h => h.includes('uptime') || h.includes('可用率') || h.includes('稼働率') || h.includes('가동률'));
  res.opcRowIsDown = comps[1].children[0].innerHTML.includes('badge-down');
  const row0 = comps[0].children[0];
  row0.listeners.click();
  res.expandedAfterClick = comps[0].className.includes('open');
  res.detailHasTable = comps[0].children[1].innerHTML.includes('<table>');

  const histRows = byId['history'].children;
  res.historyRows = histRows.length;
  res.historyCellCounts = histRows.map(r => {
    const cells = findAll(r, e => e.className.split(' ').includes('history-cells'))[0];
    return cells.children.length;
  });
  // 0823-sp-3b：每组件「有数据」格子数（非 st-none）
  res.perCompNonNone = histRows.map(r => {
    const cells = findAll(r, e => e.className.split(' ').includes('history-cells'))[0];
    let n = 0;
    cells.children.forEach(cell => { if (!cell.className.includes('st-none')) n++; });
    return n;
  });
  const allCells = findAll(byId['history'], e => e.tagName === 'div' && /^cell /.test(e.className));
  res.cellClassSet = [...new Set(allCells.map(c => c.className))];
  res.sampleTitle = allCells[allCells.length - 1].attributes.title || allCells[allCells.length - 1].title || '';

  res.incidentCount = byId['incident-list'].children.length;
  res.ongoingFound = count(byId['incident-list'], e => e._innerHTML.includes('state-ongoing'));

  // ---- langBtn/langMenu 交互断言 ----
  const langBtn = byId['langBtn'];
  const langMenu = byId['langMenu'];
  res.ariaExpandedInit = langBtn.getAttribute('aria-expanded');
  langBtn.listeners.click({ stopPropagation() {} });
  res.menuOpenAfterClick = langMenu.className.includes('open');
  res.ariaExpandedOpen = langBtn.getAttribute('aria-expanded');
  document.listeners.click({ stopPropagation() {} });
  res.menuClosedByOutsideClick = !langMenu.className.includes('open');
  res.ariaExpandedClose = langBtn.getAttribute('aria-expanded');
  langBtn.listeners.click({ stopPropagation() {} });
  const curOpt = langOpts.find(o => o.getAttribute('data-lang') === (mode === 'zh' ? 'zh' : 'en'));
  curOpt.listeners.click({});
  res.ariaExpandedAfterSameLang = langBtn.getAttribute('aria-expanded');
  const activeOpts = langOpts.filter(o => o.className.includes('active'));
  res.activeLang = activeOpts.length === 1 ? activeOpts[0].getAttribute('data-lang') : null;
  const targetLang = mode === 'zh' ? 'en' : 'zh';
  const targetOpt = langOpts.find(o => o.getAttribute('data-lang') === targetLang);
  targetOpt.listeners.click({});
  res.persistedLang = store['site-lang-v2'];
  res.urlSynced = typeof replacedState === 'string' && replacedState.indexOf('lang=' + targetLang) >= 0;
  res.reloaded = reloaded === true;
  reloaded = false;
  langBtn.listeners.click({ stopPropagation() {} });
  const curOpt2 = langOpts.find(o => o.getAttribute('data-lang') === (mode === 'zh' ? 'zh' : 'en'));
  curOpt2.listeners.click({});
  res.noReloadOnSameLang = reloaded === false;

  const commonOk =
    res.componentCount === 5 &&
    res.firstRowHasName && res.rowHasBadge && res.rowHasMetrics && res.opcRowIsDown &&
    res.historyRows === 5 &&
    res.historyCellCounts.every(n => n === 90) &&
    res.expandedAfterClick && res.detailHasTable &&
    res.noUndefined && brand.ok &&
    res.htmlLang === (mode === 'zh' ? 'zh' : 'en') &&
    res.langCur === (mode === 'zh' ? '中文' : 'English') &&
    res.ariaExpandedInit === 'false' &&
    res.menuOpenAfterClick && res.ariaExpandedOpen === 'true' &&
    res.menuClosedByOutsideClick && res.ariaExpandedClose === 'false' &&
    res.ariaExpandedAfterSameLang === 'false' &&
    res.activeLang === (mode === 'zh' ? 'zh' : 'en') &&
    res.persistedLang === targetLang &&
    res.urlSynced && res.reloaded &&
    res.noReloadOnSameLang;

  if (wmode) {
    // ---- 0823-sp-3b 三窗口断言（语言=en，mock=status-{d}d.json） ----
    if (wdays === 1) {
      // 横幅：所有组件 data_days<7 → collecting（灰点 unknown 样式）
      res.bannerCollecting = res.overallText === 'Collecting data…' && res.overallClass.includes('overall-unknown');
      // uptime 标注：website「100.00% · based on 1 day」（100% 也带标注）；api data_days=0 → 「—」不显示 %
      res.uptimeDayNote = rowHTML[0].includes('100.00%') && rowHTML[0].includes('based on 1 day');
      res.noDataDash = rowHTML[4].includes('—') && !rowHTML[4].includes('%');
      // 热力图：今天 live 格 4 组件有数据，api（无积累期）0 格
      res.histWindowOk = JSON.stringify(res.perCompNonNone) === JSON.stringify([1, 1, 1, 1, 0]);
      // 事件记录空态：empty-state 占位
      res.incidentsEmptyOk = res.incidentCount === 1 &&
        byId['incident-list'].children[0].className.includes('empty-state');
      res.ok = commonOk && res.bannerCollecting && res.uptimeDayNote && res.noDataDash &&
               res.histWindowOk && res.incidentsEmptyOk;
    } else if (wdays === 7) {
      // 横幅：任一组件 data_days>=7 → 真实 overall（mock overall=down）
      res.bannerReal = res.overallText === 'Systems down' && res.overallClass.includes('overall-down');
      // uptime 标注：「99.98% · based on 7 days」
      res.uptimeDayNote = rowHTML[0].includes('99.98%') && rowHTML[0].includes('based on 7 days');
      // 热力图：7 格有数据，其余 st-none
      res.histWindowOk = res.perCompNonNone.every(n => n === 7);
      // 事件记录：2 条（窗口内 INC-003 + INC-002）
      res.incidentsWindowOk = res.incidentCount === 2;
      res.ok = commonOk && res.bannerReal && res.uptimeDayNote && res.histWindowOk && res.incidentsWindowOk;
    } else { // wdays === 90
      // 横幅：真实 overall
      res.bannerReal = res.overallText === 'Systems down' && res.overallClass.includes('overall-down');
      // uptime：data_days>=90 → 常规，无「based on」标注
      res.uptimeNoNote = rowHTML.every(h => !h.includes('based on'));
      // 热力图：90 格全有数据
      res.histWindowOk = res.perCompNonNone.every(n => n === 90);
      // 事件记录：3 条全量
      res.incidentsWindowOk = res.incidentCount === 3;
      res.ok = commonOk && res.bannerReal && res.uptimeNoNote && res.histWindowOk && res.incidentsWindowOk;
    }
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  // ---- 既有 zh/en 模式（mock/status.json = 90 天全量）：保留全部原断言 + 90 天 uptime 无标注 ----
  res.incidentCount3 = res.incidentCount === 3;
  res.uptimeNoNote = rowHTML.every(h => !h.includes('based on'));
  res.ok =
    commonOk &&
    res.incidentCount3 &&
    res.ongoingFound >= 1 &&
    res.uptimeNoNote;

  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}, 80);
