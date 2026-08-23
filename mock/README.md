# 本地预览（mock 数据）

页面只 fetch 同域 `./status.json`。本地预览：

```bash
cd status-page
cp mock/status.json ./status.json   # mock: 90 天历史 + 3 条 incidents + opc=down / api=degraded
python3 -m http.server 8080
# 打开 http://localhost:8080/
```

预览完删掉根目录的 status.json（它是 32a 探针 workflow 的产物，不手动提交）：

```bash
rm ./status.json
```

验证优雅降级：不放 status.json 直接开 http.server，页面应显示「Collecting data… / 数据收集中」占位而非白屏。
