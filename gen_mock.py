import json, random, datetime, os, sys

# 0823-sp-3b：支持生成三窗口 fixture（1 / 7 / 90 天），输出到 mock/ 下独立文件或参数化。
# 用法：
#   python3 gen_mock.py        → 90 天 → mock/status.json（默认，兼容既有 zh/en/missing 测试）
#   python3 gen_mock.py 1|7|90 → 对应窗口 → mock/status-{d}d.json
# data_days 口径与 probe 一致：90 天窗口内有数据自然天数（含当天 live 格，历史生成 days-1 天 + 今天 fallback）。
# 1 天窗口特殊：api 组件模拟「无积累期」（data_days=0 / uptime_90d=null / status=unknown）用于页面「—」渲染断言。

random.seed(42)
base = datetime.date(2026, 8, 23)
components = [
    {"id": "website", "name": "官网", "name_en": "Website", "url": "https://www.hermes.cc.cd/"},
    {"id": "opc", "name": "OPC 透明办公室(API)", "name_en": "OPC Office (API)", "url": "https://opc.hermes.cc.cd/api/token-stats"},
    {"id": "mrd", "name": "MRD 行情面板", "name_en": "MRD Dashboard", "url": "https://mrd.hermes.cc.cd/"},
    {"id": "blog", "name": "官网博客", "name_en": "Blog", "url": "https://www.hermes.cc.cd/blog/"},
    {"id": "api", "name": "API 网关", "name_en": "API Gateway", "url": "https://api.hermes.cc.cd/"},
]
status = {"website": "operational", "opc": "down", "mrd": "operational", "blog": "operational", "api": "degraded"}
uptime = {"website": 99.98, "opc": 97.42, "mrd": 99.95, "blog": 100.0, "api": 99.61}
latency = {"website": 120, "opc": 340, "mrd": 210, "blog": 118, "api": 460}


def main(days=90, out=None):
    if out is None:
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock", "status-%dd.json" % days)

    history = {}
    # 窗口含今天（今天 live 格 fallback 组件 status）；历史生成 days-1 天 → data_days = days
    for i in range(days - 1, 0, -1):
        day = (base - datetime.timedelta(days=i)).isoformat()
        row = {}
        for c in components:
            r = random.random()
            cid = c["id"]
            if cid == "opc" and 28 <= i <= 30:
                row[cid] = "down"
            elif cid == "api" and i <= 3:
                row[cid] = "degraded" if r < 0.7 else "operational"
            elif r < 0.005:
                row[cid] = "down"
            elif r < 0.03:
                row[cid] = "degraded"
            else:
                row[cid] = "operational"
        history[day] = row

    now = datetime.datetime(2026, 8, 23, 11, 30, 0)

    def iso(dt):
        return dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")

    st = dict(status)
    up = dict(uptime)
    no_data = set()  # 无积累期组件（data_days=0 / uptime_90d=null / 无今日探测）
    if days == 1:
        # 1 天窗口：4 个组件有首日数据（100%/0% 均带「基于 1 天」标注）；api 模拟无积累期 → 「—」
        st["api"] = "unknown"
        up["api"] = None
        up["website"] = 100.0
        up["mrd"] = 100.0
        up["blog"] = 100.0
        up["opc"] = 0.0
        no_data.add("api")

    comps = []
    for c in components:
        cid = c["id"]
        checks = []
        if cid not in no_data:
            for j in range(12):
                tt = now - datetime.timedelta(minutes=5 * (12 - j))
                ok = not (cid == "opc" and j >= 6) and not (cid == "api" and j == 10)
                checks.append({"t": iso(tt), "ok": ok,
                               "latency_ms": latency[cid] + random.randint(-30, 80),
                               "code": 200 if ok else (502 if cid == "api" else 0)})
        comps.append({**c, "status": st[cid], "uptime_90d": up[cid],
                      "data_days": 0 if cid in no_data else days,
                      "latency_avg_ms": latency[cid], "last_check": iso(now),
                      "today_checks": checks})

    inc003 = {"id": "INC-003", "started": iso(now - datetime.timedelta(minutes=35)), "resolved": None,
              "severity": "major", "affected": ["opc"], "summary": "OPC API 不可达", "failed_checks": 7}
    inc002 = {"id": "INC-002", "started": iso(datetime.datetime(2026, 8, 21, 3, 10)),
              "resolved": iso(datetime.datetime(2026, 8, 21, 3, 40)),
              "severity": "minor", "affected": ["api"], "summary": "API gateway elevated latency", "failed_checks": 3}
    inc001 = {"id": "INC-001", "started": iso(datetime.datetime(2026, 7, 25, 14, 0)),
              "resolved": iso(datetime.datetime(2026, 7, 25, 15, 20)),
              "severity": "major", "affected": ["opc", "api"], "summary": "cloudflared 隧道中断", "failed_checks": 16}
    if days == 1:
        incidents = []  # 1 天窗口无历史事件 → 页面「暂无事件记录。」占位
    elif days == 7:
        incidents = [inc003, inc002]
    else:
        incidents = [inc003, inc002, inc001]

    mock = {
        "schema_version": 1,
        "generated_at": iso(now),
        "overall": "down",
        "components": comps,
        "history_90d": history,
        "incidents": incidents,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(mock, f, ensure_ascii=False, indent=2)
    print("wrote", out, "days:", days, "history_entries:", len(history),
          "components:", len(comps), "data_days:", [c["data_days"] for c in comps])


if __name__ == "__main__":
    if len(sys.argv) > 1:
        days = int(sys.argv[1])
        if days not in (1, 7, 90):
            print("usage: gen_mock.py [1|7|90]  (default 90 → mock/status.json; others → mock/status-{d}d.json)")
            sys.exit(2)
        main(days)
    else:
        # 无参默认 90 天写 mock/status.json（兼容既有 zh/en/missing 测试）
        main(90, os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock", "status.json"))
