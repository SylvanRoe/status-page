#!/usr/bin/env node
'use strict';
/**
 * state-machine-test.cjs — 状态机全链路本地测试
 *
 * 验证（验收标准：本地可用 mock 服务测状态机）：
 *   ok → degraded → down×3 → incident 开 → 恢复 → 2×ok → 回绿/resolved
 *   + history 跨日折叠 + uptime 计算 + 90 天裁剪 + .bak 容错
 *
 * 用法：node test/state-machine-test.cjs   （在仓库根目录运行）
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const assert = require('assert');

const REPO_ROOT = path.join(__dirname, '..');
const PROBE = path.join(REPO_ROOT, 'scripts', 'probe.cjs');

// ---------- 基础设施 ----------
let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}
function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function freePort() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
async function startMock(port) {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'test', 'mock-server.cjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('mock server start timeout')), 5000);
    child.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(to); resolve(); } });
    child.on('exit', (c) => reject(new Error(`mock server exited ${c}`)));
  });
  return child;
}
function setMode(port, mode) {
  execFileSync('curl', ['-s', `http://127.0.0.1:${port}/ctrl?mode=${mode}`], { stdio: 'ignore' });
}
function runProbe(statusFile, port, timeoutMs = 800) {
  const comps = [
    { id: 'm1', name: 'Mock 服务一', name_en: 'Mock One', url: `http://127.0.0.1:${port}/m1` },
    { id: 'm2', name: 'Mock 服务二', name_en: 'Mock Two', url: `http://127.0.0.1:${port}/m2` },
  ];
  const env = {
    ...process.env,
    PROBE_URLS: JSON.stringify(comps),
    PROBE_TIMEOUT_MS: String(timeoutMs),
    STATUS_FILE: statusFile,
  };
  execFileSync(process.execPath, [PROBE], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(fs.readFileSync(statusFile, 'utf8'));
}
function writeState(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }
function baseComponents(port) {
  return [
    { id: 'm1', name: 'Mock 服务一', name_en: 'Mock One', url: `http://127.0.0.1:${port}/m1` },
    { id: 'm2', name: 'Mock 服务二', name_en: 'Mock Two', url: `http://127.0.0.1:${port}/m2` },
  ];
}
function craftState(port, opts = {}) {
  const st = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    overall: 'operational',
    components: baseComponents(port).map((c) => ({
      ...c, status: 'operational', uptime_90d: 100, latency_avg_ms: 0,
      last_check: null, today_checks: opts.todayChecks || [],
    })),
    history_90d: opts.history || {},
    incidents: opts.incidents || [],
  };
  return st;
}
const compById = (st, id) => st.components.find((c) => c.id === id);

// ---------- 测试主体 ----------
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'status-test-'));
  const statusFile = path.join(tmp, 'status.json');
  const port = await freePort();
  const mock = await startMock(port);
  console.log(`[test] mock on :${port}, status file ${statusFile}`);

  try {
    // ---- 0. 纯函数单元断言：data_days 口径 + uptime_90d 空窗 null ----
    const probe = require(PROBE);
    check('单元: 空窗口（无任何 history）→ uptime_90d=null、data_days=0', () => {
      assert.strictEqual(probe.computeUptime90d({ history_90d: {} }, 'x'), null);
      assert.strictEqual(probe.computeDataDays({ history_90d: {} }, 'x'), 0);
    });
    {
      // 91 天数据：窗口内 90 天（today-89..today）+ 窗口外 1 天（today-90），窗口内 1 天 down
      const hist = {};
      for (let i = 0; i <= 90; i++) hist[isoDaysAgo(90 - i)] = { x: i === 1 ? 'down' : 'operational' };
      const st90 = { history_90d: hist };
      check('单元: 90 天窗口内 90 天数据 → data_days=90（窗口外 1 天不计）', () => {
        assert.strictEqual(probe.computeDataDays(st90, 'x'), 90);
      });
      check('单元: 窗口内 1 天 down → uptime=98.89（89/90 保留两位，degraded 计成功）', () => {
        assert.strictEqual(probe.computeUptime90d(st90, 'x'), 98.89);
      });
    }
    check('单元: initState 新组件 uptime_90d=null、data_days=0', () => {
      const s0 = probe.initState();
      assert.ok(s0.components.length >= 1);
      for (const c of s0.components) {
        assert.strictEqual(c.uptime_90d, null);
        assert.strictEqual(c.data_days, 0);
      }
    });

    // ---- 1. 基线：全 ok → operational，无 incident ----
    setMode(port, 'ok');
    runProbe(statusFile, port);
    let st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    check('基线: schema_version=1', () => assert.strictEqual(st.schema_version, 1));
    check('基线: overall=operational', () => assert.strictEqual(st.overall, 'operational'));
    check('基线: 双组件 operational', () => {
      assert.strictEqual(compById(st, 'm1').status, 'operational');
      assert.strictEqual(compById(st, 'm2').status, 'operational');
    });
    check('基线: 每个组件 1 条 today_check（t/ok/latency_ms/code，无多余字段）', () => {
      for (const c of st.components) {
        assert.strictEqual(c.today_checks.length, 1);
        const chk = c.today_checks[0];
        assert.deepStrictEqual(Object.keys(chk).sort(), ['code', 'latency_ms', 'ok', 't']);
        assert.strictEqual(chk.ok, true);
        assert.strictEqual(chk.code, 200);
      }
    });
    check('基线: 无 incidents', () => assert.strictEqual(st.incidents.length, 0));
    check('基线: data_days=1（首次探测仅今天 live 格）', () => {
      for (const c of st.components) assert.strictEqual(c.data_days, 1);
    });
    check('基线: uptime_90d 有数据（1 天全 ok → 100，非空窗 null）', () => {
      for (const c of st.components) assert.strictEqual(c.uptime_90d, 100);
    });

    // ---- 2. 5xx → degraded ----
    setMode(port, '500');
    runProbe(statusFile, port);
    st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    check('degraded: 5xx 后组件 degraded、overall degraded', () => {
      assert.strictEqual(compById(st, 'm1').status, 'degraded');
      assert.strictEqual(st.overall, 'degraded');
    });
    check('degraded: 检查 ok=false、code=500', () => {
      const last = compById(st, 'm1').today_checks.slice(-1)[0];
      assert.strictEqual(last.ok, false);
      assert.strictEqual(last.code, 500);
    });

    // ---- 3. 超时 ×3 → down → incident 开 ----
    setMode(port, 'slow');
    for (let i = 0; i < 3; i++) runProbe(statusFile, port);   // 连续 3 次 down
    st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    check('incident开: 3 次 down 后组件 down、overall down', () => {
      assert.strictEqual(compById(st, 'm1').status, 'down');
      assert.strictEqual(st.overall, 'down');
    });
    check('incident开: 两个组件各开 INC-001/INC-002，failed_checks=3，started 为首次 down 时刻', () => {
      assert.strictEqual(st.incidents.length, 2);
      const i1 = st.incidents.find((i) => i.affected[0] === 'm1');
      const i2 = st.incidents.find((i) => i.affected[0] === 'm2');
      assert.strictEqual(i1.id, 'INC-001');
      assert.strictEqual(i2.id, 'INC-002');
      assert.strictEqual(i1.failed_checks, 3);
      assert.strictEqual(i1.resolved, null);
      assert.strictEqual(i1.severity, 'major');
      // started = 3 次 down 中第一次的 t（今天）
      const m1 = compById(st, 'm1');
      assert.ok(i1.started.startsWith(isoDaysAgo(0)));
      assert.ok(m1.today_checks[m1.today_checks.length - 3].t === i1.started);
    });

    // ---- 4. 再 down 一次 → failed_checks 累计 ----
    runProbe(statusFile, port);
    st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    check('累计: 第 4 次 down → failed_checks=4', () => {
      assert.strictEqual(st.incidents.find((i) => i.affected[0] === 'm1').failed_checks, 4);
    });

    // ---- 5. 恢复：1 次 ok 仍开、2 次 ok 后 resolved ----
    setMode(port, 'ok');
    runProbe(statusFile, port);
    st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    check('恢复: 1 次 ok 后组件 operational 但 incident 未关', () => {
      assert.strictEqual(compById(st, 'm1').status, 'operational');
      assert.strictEqual(st.incidents.find((i) => i.affected[0] === 'm1').resolved, null);
    });
    runProbe(statusFile, port);
    st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    check('回绿: 连续 2 次 ok → incident resolved 写入时间', () => {
      const i1 = st.incidents.find((i) => i.affected[0] === 'm1');
      assert.ok(i1.resolved && i1.resolved.startsWith(isoDaysAgo(0)));
      assert.strictEqual(i1.failed_checks, 4); // 关闭后不再累计
      assert.strictEqual(st.overall, 'operational');
    });
    check('回绿: incidents 按 started 倒序', () => {
      const ts = st.incidents.map((i) => i.started);
      const sorted = [...ts].sort().reverse();
      assert.deepStrictEqual(ts, sorted);
    });

    // ---- 6. uptime 计算（degraded 计成功，仅 down 计失败）----
    const h1 = isoDaysAgo(1), h2 = isoDaysAgo(2), h3 = isoDaysAgo(3);
    writeState(statusFile, craftState(port, {
      todayChecks: [{ t: new Date().toISOString(), ok: true, latency_ms: 10, code: 200 }],
      history: {
        [h1]: { m1: 'down', m2: 'operational' },
        [h2]: { m1: 'operational', m2: 'degraded' },
        [h3]: { m1: 'operational', m2: 'operational' },
      },
    }));
    setMode(port, 'ok');
    runProbe(statusFile, port);
    st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    check('uptime: m1=75.00（4 天中 3 天成功，含 down 日），m2=100（degraded 计成功）', () => {
      assert.strictEqual(compById(st, 'm1').uptime_90d, 75);
      assert.strictEqual(compById(st, 'm2').uptime_90d, 100);
    });
    check('uptime: data_days=4（历史 3 天 + 今天 live 格）', () => {
      assert.strictEqual(compById(st, 'm1').data_days, 4);
      assert.strictEqual(compById(st, 'm2').data_days, 4);
    });

    // ---- 7. 跨日折叠：昨日 checks 聚合进 history，today_checks 只留当日 ----
    const yDay = isoDaysAgo(1), tDay = isoDaysAgo(0);
    writeState(statusFile, craftState(port, {
      todayChecks: [
        { t: `${yDay}T10:00:00Z`, ok: true, latency_ms: 10, code: 200 },
        { t: `${yDay}T10:05:00Z`, ok: false, latency_ms: 10, code: 500 },
        { t: `${tDay}T10:10:00Z`, ok: true, latency_ms: 10, code: 200 },
      ],
    }));
    runProbe(statusFile, port);
    st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    check('折叠: 昨日(1×ok+1×500) → history[m1]=degraded', () => {
      assert.strictEqual(st.history_90d[yDay] && st.history_90d[yDay].m1, 'degraded');
    });
    check('折叠: today_checks 只剩当日（原 1 条 + 新 1 条 = 2 条）', () => {
      const todayChecks = compById(st, 'm1').today_checks;
      assert.strictEqual(todayChecks.length, 2);
      assert.ok(todayChecks.every((c) => c.t.startsWith(tDay)));
    });
    check('折叠: degraded 日计入成功 → m1 uptime=100', () => {
      assert.strictEqual(compById(st, 'm1').uptime_90d, 100);
    });
    check('折叠: data_days=2（昨日折叠日 + 今天 live 格）', () => {
      assert.strictEqual(compById(st, 'm1').data_days, 2);
    });

    // ---- 8. 90 天裁剪 ----
    const old = isoDaysAgo(100), keep = isoDaysAgo(89);
    writeState(statusFile, craftState(port, {
      todayChecks: [{ t: new Date().toISOString(), ok: true, latency_ms: 10, code: 200 }],
      history: { [old]: { m1: 'down', m2: 'operational' }, [keep]: { m1: 'operational', m2: 'operational' } },
    }));
    runProbe(statusFile, port);
    st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    check('裁剪: 100 天前条目被裁，89 天前保留', () => {
      assert.ok(!(old in st.history_90d));
      assert.ok(keep in st.history_90d);
    });
    check('裁剪: data_days 仅计窗口内（89 天前 + 今天 = 2，100 天前不计）', () => {
      assert.strictEqual(compById(st, 'm1').data_days, 2);
    });

    // ---- 9. .bak 容错：status.json 损坏时回退备份继续 ----
    setMode(port, 'ok');
    writeState(statusFile, craftState(port, {
      todayChecks: [{ t: new Date().toISOString(), ok: true, latency_ms: 10, code: 200 }],
    }));
    runProbe(statusFile, port);                        // 生成 .bak
    const beforeBak = JSON.parse(fs.readFileSync(statusFile, 'utf8')).components.length;
    fs.writeFileSync(statusFile, '{ corrupted !!!');   // 破坏主文件
    runProbe(statusFile, port);                        // 应回退 .bak 并继续
    st = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    check('容错: 损坏后从 .bak 恢复，components 完整且 checks 继续累积', () => {
      assert.strictEqual(st.components.length, beforeBak);
      assert.strictEqual(st.components[0].today_checks.length, 2);
    });
    check('容错: data_days 字段随重算补齐（=1，仅今天）', () => {
      assert.strictEqual(st.components[0].data_days, 1);
    });

    // ---- 10. 真实 5 目标探测（仅连通性，不写正式 status.json）----
    const realFile = path.join(tmp, 'status-real.json');
    execFileSync(process.execPath, [PROBE], {
      env: { ...process.env, STATUS_FILE: realFile },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    st = JSON.parse(fs.readFileSync(realFile, 'utf8'));
    check('真实目标: 5 个组件全部被探测，schema 字段齐备', () => {
      assert.strictEqual(st.components.length, 5);
      for (const c of st.components) {
        assert.ok(['website', 'opc', 'mrd', 'blog', 'api'].includes(c.id));
        assert.ok(['operational', 'degraded', 'down'].includes(c.status));
        assert.ok(typeof c.uptime_90d === 'number');
        assert.ok(typeof c.data_days === 'number' && c.data_days >= 1);
        assert.ok(c.last_check);
        assert.strictEqual(c.today_checks.length, 1);
      }
    });

    console.log(failures === 0 ? '\n[test] ALL PASS' : `\n[test] ${failures} FAILURE(S)`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    mock.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('[test] crashed:', e); process.exit(1); });
