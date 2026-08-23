#!/usr/bin/env node
'use strict';
/**
 * mock-server.cjs — 本地状态机测试用 mock HTTP server
 *
 * 用法：node test/mock-server.cjs [port]   （默认 8901）
 * 控制：GET /ctrl?mode=ok|500|slow          （全局切换响应模式）
 *   - ok   → 所有路径返回 200
 *   - 500  → 所有路径返回 500
 *   - slow → 挂起 60s（配合短 PROBE_TIMEOUT_MS 触发超时 → down）
 */
const http = require('http');

const PORT = parseInt(process.argv[2] || process.env.MOCK_PORT || '8901', 10);
let mode = 'ok';

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (u.pathname === '/ctrl') {
    mode = u.searchParams.get('mode') || mode;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`mode=${mode}\n`);
    return;
  }
  if (mode === 'slow') {
    setTimeout(() => {
      if (!res.writableEnded) { res.writeHead(200); res.end(); }
    }, 60000);
    return; // 不响应直到超时
  }
  const code = mode === '500' ? 500 : 200;
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ mock: true, mode, ts: Date.now() }));
});

server.listen(PORT, () => {
  console.log(`[mock-server] listening on http://127.0.0.1:${PORT} mode=${mode}`);
});
