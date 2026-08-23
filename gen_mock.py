import json, random, datetime, os

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

history = {}
for i in range(90, 0, -1):
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
def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")

comps = []
for c in components:
    cid = c["id"]
    checks = []
    for j in range(12):
        tt = now - datetime.timedelta(minutes=5 * (12 - j))
        ok = not (cid == "opc" and j >= 6) and not (cid == "api" and j == 10)
        checks.append({"t": iso(tt), "ok": ok,
                       "latency_ms": latency[cid] + random.randint(-30, 80),
                       "code": 200 if ok else (502 if cid == "api" else 0)})
    comps.append({**c, "status": status[cid], "uptime_90d": uptime[cid],
                  "latency_avg_ms": latency[cid], "last_check": iso(now),
                  "today_checks": checks})

mock = {
    "schema_version": 1,
    "generated_at": iso(now),
    "overall": "down",
    "components": comps,
    "history_90d": history,
    "incidents": [
        {"id": "INC-003", "started": iso(now - datetime.timedelta(minutes=35)), "resolved": None,
         "severity": "major", "affected": ["opc"], "summary": "OPC API 不可达", "failed_checks": 7},
        {"id": "INC-002", "started": iso(datetime.datetime(2026, 8, 21, 3, 10)), "resolved": iso(datetime.datetime(2026, 8, 21, 3, 40)),
         "severity": "minor", "affected": ["api"], "summary": "API gateway elevated latency", "failed_checks": 3},
        {"id": "INC-001", "started": iso(datetime.datetime(2026, 7, 25, 14, 0)), "resolved": iso(datetime.datetime(2026, 7, 25, 15, 20)),
         "severity": "major", "affected": ["opc", "api"], "summary": "cloudflared 隧道中断", "failed_checks": 16},
    ],
}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock", "status.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(mock, f, ensure_ascii=False, indent=2)
print("wrote", out, "days:", len(history), "components:", len(comps))
