// Node DOM-stub smoke test for app.js — verifies render against mock status.json.
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
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(t, f) { this.listeners[t] = f; }
  get classList() {
    const self = this;
    return {
      toggle(c) {
        if (self.className.split(' ').includes(c)) {
          self.className = self.className.split(' ').filter(x => x !== c).join(' ');
          return false;
        }
        self.className = (self.className + ' ' + c).trim();
        return true;
      },
      contains(c) { return self.className.split(' ').includes(c); }
    };
  }
}

const ids = ['lang-toggle', 'overall', 'overall-dot', 'overall-text', 'generated-at',
  'component-list', 'history', 'incident-list'];
const byId = {};
ids.forEach(id => { byId[id] = new El('div'); });

global.document = {
  documentElement: {},
  title: '',
  getElementById: id => byId[id] || null,
  createElement: tag => new El(tag),
  querySelectorAll: () => []
};
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); }
};
Object.defineProperty(globalThis, 'navigator', {
  value: { language: mode === 'zh' ? 'zh-CN' : 'en-US' },
  configurable: true
});
global.setInterval = () => 0;

if (mode === 'zh') store['status-lang'] = 'zh';

if (mode === 'missing') {
  global.fetch = () => Promise.reject(new Error('404'));
} else {
  const mock = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock', 'status.json'), 'utf8'));
  global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(mock) });
}

function walk(el, fn) { fn(el); el.children.forEach(c => walk(c, fn)); }
function count(el, pred) { let n = 0; walk(el, e => { if (pred(e)) n++; }); return n; }
function findAll(el, pred) { const out = []; walk(el, e => { if (pred(e)) out.push(e); }); return out; }

require('./app.js');

setTimeout(() => {
  const res = {};
  res.overallText = byId['overall-text'].textContent;
  res.overallClass = byId['overall'].className;
  res.generatedAt = byId['generated-at'].textContent;

  if (mode === 'missing') {
    res.degradedMsg = byId['component-list'].children.map(c => c.textContent).join('|');
    res.ok = res.degradedMsg.includes('status.json') && res.overallText.length > 0;
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  const comps = byId['component-list'].children;
  res.componentCount = comps.length;
  // component row content is set via innerHTML (string in our stub) — inspect it directly
  const rowHTML = comps.map(c => c.children[0].innerHTML);
  res.firstRowHasName = rowHTML[0].includes(mode === 'zh' ? '官网' : 'Website');
  res.rowHasBadge = rowHTML.every(h => /badge badge-(operational|degraded|down|unknown)/.test(h));
  res.rowHasMetrics = rowHTML.every(h => h.includes('uptime') || h.includes('可用率'));
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

  res.ok =
    res.componentCount === 5 &&
    res.firstRowHasName && res.rowHasBadge && res.rowHasMetrics && res.opcRowIsDown &&
    res.historyRows === 5 &&
    res.historyCellCounts.every(n => n === 90) &&
    res.incidentCount === 3 &&
    res.ongoingFound >= 1 &&
    res.expandedAfterClick && res.detailHasTable;

  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}, 50);
