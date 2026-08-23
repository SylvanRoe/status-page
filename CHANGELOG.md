# Changelog

本仓版本制度（资产版本制度 v1.0，2026-08-23 落地）：版本号 = git tag `vX.Y.Z` + 本文件条目；语义 semver（主.次.补丁）。

## [v0.1.0] - 2026-08-23
### Added
- 32a：status-page 探针采集 — GitHub workflow + probe.cjs + status.json 种子 + README + 测试
- 32b：状态页静态渲染器（status.json schema v1 契约）— 总体横幅 / 组件列表（今日检查可展开）/ 90 天可用性热力图 / 事件时间线，Vanilla JS 零外部依赖；mock fixture 生成器 + DOM smoke 测试辅助
- 32c：deploy-pages.yml — CF Pages 自动部署 workflow（status-page 项目，部署根目录）；workflow_run 触发补链（探针 push status.json 后自动部署，GITHUB_TOKEN push 不触发 push 事件）
- 32d：修复 computeUptime90d 先按 90 天窗口裁剪再计算（窗口外历史计入分母）+ 移动端 90 天热力图横向溢出
