#!/usr/bin/env node
'use strict';
/**
 * probe.cjs — status-page 探针采集脚本（status.json 唯一数据源生成器）
 *
 * 职责：探测 5 个对外服务 → 追加本次检查 → 重算状态机 → 原子写回 status.json。
 * 只在 GitHub Actions runner 上运行（探针 100% 外部化：仅请求公网 URL）。
 * 本机仅可用于测试（PROBE_URLS/STATUS_FILE/PROBE_TIMEOUT_MS 环境变量覆盖）。
 *
 * 判定规则（单次探测）：
 *   HTTP 2xx/3xx/4xx = ok（4xx 表示可达仅路径问题）
 *   HTTP 5xx         = degraded
 *   超时(默认10s)/连接失败/DNS/TLS 失败 = down（code=0）
 *
 * 状态机：
 *   组件当前状态（恢复感知）：最后一次失败之后的检查聚合；失败已恢复 → operational（回绿），
 *     仍处失败中 → degraded/down。恢复后状态即回绿（对齐验收「恢复→回绿」）。
 *   每日最坏聚合 → history_90d（含当天 live 格）：今日 checks 全 ok → operational；
 *     有 degraded 无 down → degraded；有 down → down（供热力图/uptime）
 *   组件 90 天 uptime：成功天数/总天数（degraded 计成功，仅 down 计失败），保留两位小数
 *   overall：任一 down → down；任一 degraded → degraded；否则 operational
 *   incident：组件连续 3 次 down（≈15 分钟）→ 开 incident（INC-NNN 递增，major，failed_checks 累计）；
 *             连续 2 次 ok → resolved（写入时间）。incidents 只追加不删除，按 started 倒序。
 *   跨日折叠：昨日及更早 today_checks 按日聚合进 history_90d，today_checks 只留当日
 *   90 天裁剪：history_90d 仅保留今天往前 90 天
 *
 * 写入安全：写 status.json.bak 备份 → 写 status.json.tmp → 原子 rename。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_COMPONENTS = [
  { id: 'website', name: '官网', name_en: 'Website', url: 'https://www.hermes.cc.cd/' },
  { id: 'opc', name: 'OPC 透明办公室(API)', name_en: 'OPC Office (API)', url: 'https://opc.hermes.cc.cd/api/token-stats' },
  { id: 'mrd', name: 'MRD 行情面板', name_en: 'MRD Dashboard', url: 'https://mrd.hermes.cc.cd/' },
  { id: 'blog', name: '官网博客', name_en: 'Blog', url: 'https://www.hermes.cc.cd/blog/' },
  { id: 'api', name: 'API 网关(cloudflared 隧道)', name_en: 'API Gateway (Tunnel)', url: 'https://api.hermes.cc.cd/' },
];

const TIMEOUT_MS = parseInt(process.env.PROBE_TIMEOUT_MS || '10000', 10);
const STATUS_FILE = process.env.STATUS_FILE || path.join(__dirname, '..', 'status.json');
const COMPONENTS = process.env.PROBE_URLS ? JSON.parse(process.env.PROBE_URLS) : DEFAULT_COMPONENTS;

const NOW = new Date();
const NOW_ISO = NOW.toISOString();          // UTC ISO8601
const TODAY = NOW_ISO.slice(0, 10);         // UTC 日期（跨日边界按 UTC，README 有说明）
const HISTORY_DAYS = 90;                    // 保留窗口
const INCIDENT_TRIGGER_DOWNS = 3;           // 连续 down 次数 → 开 incident
const INCIDENT_RESOLVE_OKS = 2;             // 连续 ok 次数 → 关 incident

// ---------------------------------------------------------------- helpers

function dateOfIso(iso) { return iso.slice(0, 10); }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 单次检查状态：ok | degraded | down（由 code 推导；0/null = 非 HTTP 失败） */
function statusOfCode(code) {
  if (code >= 200 && code <= 499) return 'ok';
  if (code >= 500) return 'degraded';
  return 'down';
}

/** 一组检查的聚合状态：有 down → down；有 degraded → degraded；否则 operational */
function aggregateStatus(checks) {
  let hasDegraded = false;
  for (const c of checks) {
    const s = statusOfCode(c.code);
    if (s === 'down') return 'down';
    if (s === 'degraded') hasDegraded = true;
  }
  return hasDegraded ? 'degraded' : 'operational';
}

/**
 * 组件当前状态（恢复感知）：
 * 取最后一次失败（非 ok）检查之后的检查聚合；失败已恢复 → operational（回绿），
 * 仍处失败中 → 该失败本身的状态。每日最坏聚合另存 history_90d（供热力图/uptime）。
 */
function currentStatus(checks) {
  let lastBad = -1;
  for (let i = checks.length - 1; i >= 0; i--) {
    if (statusOfCode(checks[i].code) !== 'ok') { lastBad = i; break; }
  }
  if (lastBad === -1) return aggregateStatus(checks);       // 今日全 ok（或空）→ operational
  const after = checks.slice(lastBad + 1);
  if (after.length === 0) {
    // 当前检查即失败：取该失败的状态
    return statusOfCode(checks[lastBad].code) === 'degraded' ? 'degraded' : 'down';
  }
  return aggregateStatus(after);                            // 恢复后全 ok → operational
}

function round2(x) { return Math.round(x * 100) / 100; }

// ---------------------------------------------------------------- probe

async function probeOne(comp) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  let code = 0;
  try {
    // redirect: 'manual' → 3xx 原样记录（按判定规则 3xx=ok）
    const res = await fetch(comp.url, { redirect: 'manual', signal: ctrl.signal });
    code = res.status;
  } catch {
    code = 0; // 超时 / DNS / TLS / 连接失败 → down
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - t0;
  const status = statusOfCode(code);
  return {
    t: new Date().toISOString(),
    ok: status === 'ok',
    latency_ms: latencyMs,
    code,
    _status: status, // 内部推导字段，不写入 status.json
  };
}

// ---------------------------------------------------------------- state machine

function loadState() {
  for (const f of [STATUS_FILE, STATUS_FILE + '.bak']) {
    try {
      const raw = fs.readFileSync(f, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && Array.isArray(data.components)) return data;
    } catch { /* try next */ }
  }
  return null; // 初始化
}

function initState() {
  return {
    schema_version: 1,
    generated_at: NOW_ISO,
    overall: 'operational',
    components: COMPONENTS.map((c) => ({
      id: c.id,
      name: c.name,
      name_en: c.name_en,
      url: c.url,
      status: 'operational',
      uptime_90d: 100.0,
      latency_avg_ms: 0,
      last_check: null,
      today_checks: [],
    })),
    history_90d: {},
    incidents: [],
  };
}

/** 把非今日的 today_checks 按日聚合折叠进 history_90d；返回仅今日的 checks */
function foldAcrossDays(state, compId) {
  const comp = state.components.find((c) => c.id === compId);
  const keep = [];
  const byDate = new Map();
  for (const chk of comp.today_checks) {
    const d = dateOfIso(chk.t);
    if (d === TODAY) { keep.push(chk); continue; }
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(chk);
  }
  for (const [d, checks] of byDate) {
    if (!state.history_90d[d]) state.history_90d[d] = {};
    state.history_90d[d][compId] = aggregateStatus(checks);
  }
  comp.today_checks = keep;
}

function trimHistory(state) {
  const cutoff = addDays(TODAY, -(HISTORY_DAYS - 1)); // 含今天共 90 天
  for (const d of Object.keys(state.history_90d)) {
    if (d < cutoff) delete state.history_90d[d];
  }
}

function computeUptime90d(state, compId) {
  // 历史仅按日聚合（含当天 live 格），uptime 以天为粒度：成功天数/总天数（degraded 计成功）
  let total = 0;
  let success = 0;
  for (const [d, dayMap] of Object.entries(state.history_90d)) {
    if (typeof dayMap !== 'object' || dayMap === null) continue;
    if (!(compId in dayMap)) continue;
    total += 1;
    if (dayMap[compId] !== 'down') success += 1;
  }
  if (total === 0) return 100.0;
  return round2((success / total) * 100);
}

function computeLatencyAvg(comp) {
  const lat = comp.today_checks.filter((c) => c.latency_ms > 0).map((c) => c.latency_ms);
  if (lat.length === 0) return 0;
  return Math.round(lat.reduce((a, b) => a + b, 0) / lat.length);
}

function nextIncidentId(incidents) {
  let max = 0;
  for (const inc of incidents) {
    const m = /^INC-(\d+)$/.exec(inc.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `INC-${String(max + 1).padStart(3, '0')}`;
}

function processIncidents(state) {
  for (const comp of state.components) {
    const checks = comp.today_checks;
    const open = state.incidents.find((i) => i.affected.includes(comp.id) && !i.resolved);
    const curStatus = currentStatus(checks); // 恢复感知：故障中 down/degraded，恢复后 operational
    const trailing = (pred) => {
      let n = 0;
      for (let i = checks.length - 1; i >= 0; i--) {
        if (pred(statusOfCode(checks[i].code))) n++;
        else break;
      }
      return n;
    };

    if (open) {
      if (curStatus === 'down') {
        open.failed_checks += 1;
      } else if (trailing((s) => s === 'ok') >= INCIDENT_RESOLVE_OKS) {
        open.resolved = NOW_ISO;
      }
    } else {
      const downStreak = trailing((s) => s === 'down');
      if (downStreak >= INCIDENT_TRIGGER_DOWNS) {
        const started = checks[checks.length - downStreak].t; // 首次 down 的时刻
        state.incidents.push({
          id: nextIncidentId(state.incidents),
          started,
          resolved: null,
          severity: 'major',
          affected: [comp.id],
          summary: `${comp.name} 不可达`,
          failed_checks: downStreak,
        });
      }
    }
  }
  // incidents 只追加不删除，按 started 倒序
  state.incidents.sort((a, b) => b.started.localeCompare(a.started));
}

// ---------------------------------------------------------------- main

async function main() {
  // 1. 读现有状态（不存在/损坏则初始化；损坏时回退 .bak，README 有说明）
  let state = loadState();
  const hadState = !!state;
  if (!state) {
    state = initState();
  } else {
    // 补全新组件（组件清单演进时老状态缺项）
    for (const c of COMPONENTS) {
      if (!state.components.find((x) => x.id === c.id)) {
        state.components.push({
          id: c.id, name: c.name, name_en: c.name_en, url: c.url,
          status: 'operational', uptime_90d: 100.0, latency_avg_ms: 0,
          last_check: null, today_checks: [],
        });
      }
    }
  }

  // 2. 探针（并行）
  const results = await Promise.all(COMPONENTS.map(probeOne));

  // 3. 逐组件：跨日折叠 → 追加 → 重算（当前状态 + 当天 live 聚合格）
  for (let i = 0; i < COMPONENTS.length; i++) {
    const c = COMPONENTS[i];
    const r = results[i];
    const comp = state.components.find((x) => x.id === c.id);
    foldAcrossDays(state, c.id);
    comp.today_checks.push({ t: r.t, ok: r.ok, latency_ms: r.latency_ms, code: r.code });
    comp.status = currentStatus(comp.today_checks);
    // history_90d 当天 live 格：每日最坏聚合（与跨日折叠同规则），供热力图/uptime
    if (!state.history_90d[TODAY]) state.history_90d[TODAY] = {};
    state.history_90d[TODAY][c.id] = aggregateStatus(comp.today_checks);
    comp.uptime_90d = computeUptime90d(state, c.id);
    comp.latency_avg_ms = computeLatencyAvg(comp);
    comp.last_check = r.t;
  }

  // 4. 裁剪 history + incident 状态机
  trimHistory(state);
  processIncidents(state);

  // 5. overall
  const anyDown = state.components.some((c) => c.status === 'down');
  const anyDegraded = state.components.some((c) => c.status === 'degraded');
  state.overall = anyDown ? 'down' : (anyDegraded ? 'degraded' : 'operational');

  // 6. 原子写回：备份 → tmp → rename
  state.generated_at = NOW_ISO;
  const out = JSON.stringify(state, null, 2) + '\n';
  if (fs.existsSync(STATUS_FILE)) {
    fs.copyFileSync(STATUS_FILE, STATUS_FILE + '.bak');
  }
  fs.writeFileSync(STATUS_FILE + '.tmp', out, 'utf8');
  fs.renameSync(STATUS_FILE + '.tmp', STATUS_FILE);

  // 7. 摘要输出（workflow 日志可读）
  console.log(`[probe] ${NOW_ISO} overall=${state.overall} components=${state.components.length} had_state=${hadState}`);
  for (const comp of state.components) {
    const last = comp.today_checks[comp.today_checks.length - 1];
    const detail = last ? `${statusOfCode(last.code)} ${last.latency_ms}ms code=${last.code}` : 'no-data';
    console.log(`[probe]   ${comp.id.padEnd(8)} ${comp.status.padEnd(12)} uptime=${comp.uptime_90d}% avg=${comp.latency_avg_ms}ms ${detail}`);
  }
}

main().catch((err) => {
  console.error('[probe] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
