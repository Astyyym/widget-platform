# G1-A Zebar 最小对照

这个原型只展示标明为合成数据的 CPU 摘要、点击打开独立输入面板，以及隐藏/重开摘要。输入内容只保存在当前 WebView 内存中，不会持久化。页面没有读取真实 CPU、网络、账号、对话或系统剪贴板。

## 本地运行

1. 在本目录运行 `npm ci`，再运行 `npm run build`，把 pinned Zebar client API bundle 到 pack 目录。
2. 使用官方 Zebar Windows x64 v3.3.1 release；本地对照包解压在 `.runtime/`，不属于项目源码。
3. 从项目根运行 `pwsh -NoProfile -File prototypes/zebar/start-local.ps1`。脚本把 Zebar 的 config directory、APPDATA 和 LOCALAPPDATA 都限制在本目录下，不注册 startup。
4. 点击摘要上的 `展开输入`，输入合成内容；面板上的 `隐藏面板` 关闭独立窗口。摘要上的 `隐藏摘要` 关闭摘要，Zebar CLI 的 `start-widget-preset` 可再次打开。

## 目录

- `config/widget-platform-g1a/zpack.json`：声明摘要和输入面板两个独立窗口。
- `config/widget-platform-g1a/*.html`、`styles.css`、`widget-api.js`：原型页面与本地 API bundle。
- `src/widget.js`、`package.json`、`package-lock.json`：使用固定的 `zebar@3.3.1` client API，并通过 `esbuild` 生成本地 bundle。
- `.runtime/`、`.runtime-profile/`：可重建的本地运行文件和临时 profile，均由本地 `.gitignore` 排除。

真实运行步骤、版本来源、差距和未验证范围见 [`evidence/G1-A/result.md`](../../evidence/G1-A/result.md)。
