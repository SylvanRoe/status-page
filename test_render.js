// Node DOM-stub smoke test for app.js — verifies render against mock status.json.
// 0823-sp-2: i18n 机制升级适配 — URL 感知 fetch（locales/*.json 语言包 + status.json）、
// langBtn/langMenu 交互、site-lang-v2 持久化、no-undefined 断言。
// 0823-sp-2a-fix: langBtn aria-expanded 动态管理断言（初始 false / 打开 true / 外部点击关闭 false）。
// Usage: node test_render.js [zh|en|missing]
'use strict';
const fs = require('fs');
const path = require('path');

const mode = process.argv[2] || 'en';

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
  const mock = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock', 'status.json'), 'utf8'));
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

require('./app.js');

setTimeout(() => {
  const res = {};
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
             res.noUndefined && res.htmlLang === 'en' && res.langCur === 'English';
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  const comps = byId['component-list'].children;
  res.componentCount = comps.length;
  // component row content is set via innerHTML (string in our stub) — inspect it directly
  const rowHTML = comps.map(c => c.children[0].innerHTML);
  res.firstRowHasName = rowHTML[0].includes(mode === 'zh' ? '官网' : 'Website');
  res.rowHasBadge = rowHTML.every(h => /badge badge-(operational|degraded|down|unknown)/.test(h));
  res.rowHasMetrics = rowHTML.every(h => h.includes('uptime') || h.includes('可用率') || h.includes('稼働率') || h.includes('가동률'));
  res.opcRowIsDown = comps[1].children[0].innerHTML.includes('badge-down');
  // expand first component (simulate click) and check today_checks table rendered
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
  const allCells = findAll(byId['history'], e => e.tagName === 'div' && /^cell /.test(e.className));
  res.cellClassSet = [...new Set(allCells.map(c => c.className))];
  res.sampleTitle = allCells[allCells.length - 1].attributes.title || allCells[allCells.length - 1].title || '';

  res.incidentCount = byId['incident-list'].children.length;
  res.ongoingFound = count(byId['incident-list'], e => e._innerHTML.includes('state-ongoing'));

  // ---- langBtn/langMenu 交互断言 ----
  const langBtn = byId['langBtn'];
  const langMenu = byId['langMenu'];
  res.ariaExpandedInit = langBtn.getAttribute('aria-expanded'); // 初始应为 'false'
  langBtn.listeners.click({ stopPropagation() {} });
  res.menuOpenAfterClick = langMenu.className.includes('open');
  res.ariaExpandedOpen = langBtn.getAttribute('aria-expanded'); // 打开后应为 'true'
  // 外部点击关闭 → aria-expanded 回 false
  document.listeners.click({ stopPropagation() {} });
  res.menuClosedByOutsideClick = !langMenu.className.includes('open');
  res.ariaExpandedClose = langBtn.getAttribute('aria-expanded'); // 关闭后应为 'false'
  // 再点开，点当前语言 → 关闭菜单 + aria-expanded=false + 不 reload
  langBtn.listeners.click({ stopPropagation() {} });
  const curOpt = langOpts.find(o => o.getAttribute('data-lang') === (mode === 'zh' ? 'zh' : 'en'));
  curOpt.listeners.click({});
  res.ariaExpandedAfterSameLang = langBtn.getAttribute('aria-expanded');
  // active 高亮：当前语言 option 应为 active
  const activeOpts = langOpts.filter(o => o.className.includes('active'));
  res.activeLang = activeOpts.length === 1 ? activeOpts[0].getAttribute('data-lang') : null;
  // 切换：en 模式点 zh → 写 site-lang-v2 + URL ?lang= + reload
  const targetLang = mode === 'zh' ? 'en' : 'zh';
  const targetOpt = langOpts.find(o => o.getAttribute('data-lang') === targetLang);
  targetOpt.listeners.click({});
  res.persistedLang = store['site-lang-v2'];
  res.urlSynced = typeof replacedState === 'string' && replacedState.indexOf('lang=' + targetLang) >= 0;
  res.reloaded = reloaded === true;
  // 点击已激活语言 → 不 reload 只关菜单
  reloaded = false;
  // 先重新打开菜单（模拟真实交互链），再点当前语言
  langBtn.listeners.click({ stopPropagation() {} });
  const curOpt2 = langOpts.find(o => o.getAttribute('data-lang') === (mode === 'zh' ? 'zh' : 'en'));
  curOpt2.listeners.click({});
  res.noReloadOnSameLang = reloaded === false;

  res.ok =
    res.componentCount === 5 &&
    res.firstRowHasName && res.rowHasBadge && res.rowHasMetrics && res.opcRowIsDown &&
    res.historyRows === 5 &&
    res.historyCellCounts.every(n => n === 90) &&
    res.incidentCount === 3 &&
    res.ongoingFound >= 1 &&
    res.expandedAfterClick && res.detailHasTable &&
    res.noUndefined &&
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

  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}, 80);
