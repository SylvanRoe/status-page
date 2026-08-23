# Changelog

本仓版本制度（资产版本制度 v1.0，2026-08-23 落地）：版本号 = git tag `vX.Y.Z` + 本文件条目；语义 semver（主.次.补丁）。

## [v0.2.1] - 2026-08-23
### Fixed
- 0823-sp-2a（验收 FAIL 返工）：langBtn 补 aria-expanded 动态管理（open=true/close=false，与 .lang-menu.open 同步）— index.html 静态初始 false + app.js syncLangAria()（按钮点击开合/外部点击关闭/点当前语言关闭全路径同步）；test_render.js 增 aria-expanded 三态断言防回归
- D8 观察项：旧 status-lang 迁移补写回 site-lang-v2（head bootstrap + app.js detectLang 双路径，完成真迁移，旧 key 保留）

## [v0.2.0] - 2026-08-23
### Added
- 0823-sp-2：多语言机制对齐官网（company-site/ui.js 公共组件同构）：
  - langBtn+langMenu 切换器（12 语，aria-haspopup/listbox、点击外部关闭、active 高亮、≤640px 触控 44px + .lang-cur 收窄），替换旧 lang-toggle
  - locales/*.json 12 语言包（41 键统一键集：9 静态 data-i18n + app.js 动态 dict 全量 + langAria/metaTitle/metaDescription/time 单位），翻译语义对齐官网（Hermes Status/operational/degraded/down/incidents/uptime）
  - ?lang= URL 同步（切换 replaceState 携带，分享链接直达语言、刷新保持）
  - 持久化：localStorage site-lang-v2（与官网同 key 跨站同步），兼容迁移旧 status-lang
  - 语言检测优先级：?lang= → site-lang-v2 → status-lang → navigator.languages → zh；html lang/dir 同步（ar rtl）
  - 缓存 + 防闪烁：__I18N_VER 版本号 + site-i18n-cache-v{VER}-{LANG} 语言包缓存 + .i18n-pending 门控（非 zh 首帧不闪中文）
  - JS 动态文案全量走 T()（禁硬编码中英文）；组件名 name_en/name 数据字段逻辑保留
  - scripts/gen_locales.py 语言包生成器（键集一致性校验）；test_render.js 适配新机制（URL 感知 fetch + langBtn 交互断言 + no-undefined）

## [v0.1.0] - 2026-08-23
### Added
- 32a：status-page 探针采集 — GitHub workflow + probe.cjs + status.json 种子 + README + 测试
- 32b：状态页静态渲染器（status.json schema v1 契约）— 总体横幅 / 组件列表（今日检查可展开）/ 90 天可用性热力图 / 事件时间线，Vanilla JS 零外部依赖；mock fixture 生成器 + DOM smoke 测试辅助
- 32c：deploy-pages.yml — CF Pages 自动部署 workflow（status-page 项目，部署根目录）；workflow_run 触发补链（探针 push status.json 后自动部署，GITHUB_TOKEN push 不触发 push 事件）
- 32d：修复 computeUptime90d 先按 90 天窗口裁剪再计算（窗口外历史计入分母）+ 移动端 90 天热力图横向溢出
