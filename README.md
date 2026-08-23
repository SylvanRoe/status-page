# status-page — Gavin's OPC 服务状态页数据源

OPC 透明办公室的公开服务可用性状态页。类似 status.deepseek.com 的可用性展示页，
证明商用能力。**本仓库 = 数据源**：GitHub Actions 每 5 分钟从 GitHub runner 探测
5 个对外服务 → 生成/累积 `status.json` → push 回仓库 → 自动触发部署（status.hermes.cc.cd）。

> 仓库与主站（gavin-lab / www.hermes.cc.cd）彻底隔离：故障时状态页必须活着。

## 数据流

```
GitHub Actions (schedule */5)  ──►  scripts/probe.cjs  ──►  status.json  ──►  push main
        (GitHub runner 公网探测)      (状态机累积/重算)       (页面数据源)       └─► 部署触发
```

- 探针 **100% 外部化**：只在 GitHub runner 上 `curl` 公网 URL，绝不读取公司本机文件/本机探测输出/本机 API。
- `status.json` **只由 GitHub Actions 生成**。本仓库首次提交中的 `status.json` 是空种子
  （无任何检查数据），第一次探测 run 开始累积。
- 仓库无任何凭据：GITHUB_TOKEN 由 Actions 自动注入（仅 `contents: write` 权限），无需 secrets。

## 探测目标（5 个，Gavin 已定）

| id | 名称 | URL | 说明 |
|---|---|---|---|
| website | 官网 | https://www.hermes.cc.cd/ | 主站 |
| opc | OPC 透明办公室(API) | https://opc.hermes.cc.cd/api/token-stats | GET 只读无鉴权，验证 cloudflared 隧道 + opc-api 真链路 |
| mrd | MRD 行情面板 | https://mrd.hermes.cc.cd/ | 行情面板 |
| blog | 官网博客 | https://www.hermes.cc.cd/blog/ | 博客 |
| api | API 网关(cloudflared 隧道) | https://api.hermes.cc.cd/ | 无 healthz，用根路径 + 判定规则兜底 |

## 判定规则（单次探测）

| 结果 | 判定 |
|---|---|
| HTTP 2xx / 3xx / 4xx | `ok`（4xx 表示可达仅路径问题） |
| HTTP 5xx | `degraded` |
| 超时（10s）/ 连接失败 / DNS / TLS 失败 | `down`（code=0） |

## 状态机（probe.cjs 内实现）

- **组件当前状态（恢复感知）**：取"最后一次失败（非 ok）检查之后"的检查聚合——
  失败已恢复 → `operational`（回绿）；仍处失败中 → `degraded`/`down`。
  > 说明：按验收「恢复→回绿」设计，组件/overall 在故障恢复后即回绿，而非当日全天保持红。
- **每日最坏聚合 → `history_90d`**（含当天 live 格，与跨日折叠同规则）：
  今日 checks 全 ok → `operational`；有 degraded 无 down → `degraded`；有 down → `down`。
  供热力图与 uptime（schema 示例中 `history_90d` 含当天日期即此格）。
- **组件 90 天 uptime**：`成功天数 / 有数据天数`（degraded 计成功，仅 down 计失败），保留两位小数。
  > 说明：历史仅保留按日聚合（`history_90d`），因此 uptime 以**天**为粒度计算，
  > 当天有任一 down 则该日计 0% 成功；无数据日（`data_days=0`）时 `uptime_90d` 为 **null**
  > （空窗期诚实展示，不虚报 100%）。含当天共 90 天窗口。
- **overall**：任一组件 down → `down`；任一 degraded → `degraded`；否则 `operational`
- **incident 规则**：
  - 组件连续 3 次 down（≈15 分钟）→ 开 incident：`INC-NNN` 递增、`severity=major`、
    `failed_checks` 累计（开时=3，之后每次 down +1）、`started` = 首次 down 的时刻
  - 连续 2 次 ok → `resolved` 写入时间
  - incidents 只追加不删除，按 `started` 倒序
- **跨日折叠**：跨日时把昨日及更早的 today_checks 按日聚合进 `history_90d`，`today_checks` 只留当日
- **90 天裁剪**：`history_90d` 仅保留今天往前 90 天的条目
- **自愈**：每次 run 独立（读 → 追加 → 重算 → 写回），workflow 自身失败不影响下次 run；写回前备份
  旧文件（`status.json.bak`）+ 原子写（tmp + rename），状态文件损坏时回退 `.bak`，再不行从 git 历史恢复。

## status.json schema v1（与页面 32b 的契约，勿改字段名）

```json
{
  "schema_version": 1,
  "generated_at": "ISO8601",
  "overall": "operational|degraded|down",
  "components": [
    {
      "id": "website", "name": "官网", "name_en": "Website", "url": "https://www.hermes.cc.cd/",
      "status": "operational|degraded|down",
      "uptime_90d": 99.98,
      "data_days": 23,
      "latency_avg_ms": 120,
      "last_check": "ISO8601",
      "today_checks": [{"t":"ISO8601","ok":true,"latency_ms":120,"code":200}]
    }
  ],
  "history_90d": {"2026-08-23": {"website":"operational","opc":"down","mrd":"operational","blog":"operational","api":"operational"}},
  "incidents": [
    {"id":"INC-001","started":"ISO8601","resolved":"ISO8601|null","severity":"major|minor","affected":["opc"],"summary":"OPC API 不可达","failed_checks":3}
  ]
}
```

- `today_checks[].ok` = 单次检查是否 `ok`（2xx/3xx/4xx）；degraded/down 均为 `false`，由 `code` 区分
  （`code>=500` → degraded，`code=0` → down）
- 所有时间均为 **UTC ISO8601**；跨日边界按 UTC（北京时间 08:00 为界）
- `latency_avg_ms` = 当日已测延迟均值（整数 ms）
- `data_days`（int） = 90 天窗口内该组件有数据的自然天数（含当天 live 格；空窗=0）。
  页面侧据此展示数据积累期（0823-sp-3b）：
  - 组件行 uptime：data_days>=90 → 常规「99.98%」；0<data_days<90 →「99.98% · 基于 N 天」；
    data_days=0 或 uptime_90d=null →「—」（无数据不虚报 100%）
  - 整体横幅：全组件 data_days<7 →「数据采集中…」；任一组件 >=7 → 按 overall 真实状态（判定在 app.js）
- `uptime_90d`：有数据时（`data_days>0`）为 number（成功天数/有数据天数，degraded 计成功，
  round2）；无数据日（`data_days=0`）为 **null**——空窗不虚报 100%

## 本地测试（mock 状态机全链路）

```bash
# 1. 起 mock server（可切 200/5xx/超时，默认端口 8901）
node test/mock-server.cjs &

# 2. 跑完整状态机测试：fail→degraded→down→incident 开→恢复→回绿 + history/uptime 计算
node test/state-machine-test.cjs

# 或手动单步：用环境变量覆盖探针目标/超时/输出文件
PROBE_URLS='[{"id":"m1","name":"Mock1","name_en":"Mock 1","url":"http://127.0.0.1:8901/ok"}]' \
PROBE_TIMEOUT_MS=1000 STATUS_FILE=/tmp/status-test.json \
node scripts/probe.cjs
```

mock server 控制接口：`GET /ctrl?mode=ok|500|slow`（slow = 挂起直到超时）。

## 目录结构

```
.github/workflows/status-probe.yml   # 探测 workflow（schedule + dispatch，contents: write）
scripts/probe.cjs                    # 探针 + 状态机 + 累积（唯一写 status.json 者）
status.json                          # 页面数据源（仅 Actions 更新）
test/mock-server.cjs                 # 本地 mock HTTP server（200/5xx/超时可切）
test/state-machine-test.cjs          # 状态机全链路测试
test_render.js                     # 页面 DOM smoke 测试（zh/en/missing + window 三窗口）
gen_mock.py                        # mock fixture 生成器（1/7/90 天三窗口，参数化）
locales/*.json                     # 12 语言包（键集与 app.js 内置 dict 一致，__I18N_VER 版本化）
```

## 维护

- 增删探测目标：改 `scripts/probe.cjs` 的 `DEFAULT_COMPONENTS`（老状态会自动补全新组件，移除的组件历史保留）
- 超时调整：`PROBE_TIMEOUT_MS`（默认 10000ms）
- 修改 schema 需与页面卡（32b）同步契约，字段名改动走庄子弹板
