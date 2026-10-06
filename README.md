# Widget Platform

Windows 本地桌面信息与快捷交互工具（Tauri 2 + TypeScript/Rust）。常驻低占用、内容可自定义、无需 WSL2；当前为 `0.1.0` 本机自用候选，未做代码签名。

- 仓库：<https://github.com/Astyyym/widget-platform>
- 安装包：[Releases](https://github.com/Astyyym/widget-platform/releases)（`Widget.Platform_0.1.0_x64-setup.exe`，currentUser / x64 / 未签名）
- 源码：`app/`（正式产品）、`prototypes/`（Goal 1 参考原型，非产品入口）、`icon/`、`designs/`

> **关于 `evidence/`**：本项目的过程证据（测试日志、截图、构建产物、隔离运行 profile）体积达数十 GB，且含本机 WebView2 用户数据，因此**不随仓库分发**，只保留在开发机本地。本文件及 `task_plan.md`、`findings.md` 中指向 `evidence/...` 的链接在 GitHub 上不会解析，对应内容请以本地工作区为准。

## 当前执行：G8-C-F9（2026-10-05）

修正删除透明度入口后的导航栏尾部留白；设置窗口标题栏整体可拖动，左右边缘和底部角落接入 native resize-drag；外观滑块依材质模式条件显示。前端47 files/281 tests、typecheck/build、Rust 149 passed/4 ignored及fresh raw Release构建通过。隔离真实窗口拖动/缩放、正式安装和E5尚未验证。raw SHA-256 `416f99a8933bf2ab96c529247b196d9f002e988c853e4c81c9a0740245c4dc81`；见 [G8-C-F9结果](evidence/G8-C-F9/result.md)。

## 当前执行：G8-C-F8（2026-10-05）

已将透明度设置从悬浮导航条移入“外观”设置，并增加普通背景、半透明、模糊玻璃三种材质；模糊玻璃提供独立 0–32px 模糊强度，导航条阴影同步减轻。前端 47 files / 281 tests、typecheck、build、Rust fmt/test/check 已通过；fresh Release 与哥哥正式安装/E5体验尚未补测。实施合同见 [G8-C-F8](evidence/G8-C-F8/plan.md)，当前状态以 [task_plan](task_plan.md) 为准。

## 历史重新打包候选：G8-C-F7（2026-10-04）

完成导航条透明度层、厚度联动白条、CPU/GPU/内存/Codex额度与专注/休息已用进度条、Timer状态动作精简。fresh安装包：`evidence/G8-C-F7/cargo-target/release/bundle/nsis/Widget Platform_0.1.0_x64-setup.exe`，SHA-256 `06acad690789d29f6d7ea1bf1b1551513ec421d4b6e5fbcee0a351779f427b38`；raw EXE SHA-256 `a72f326464fb1cbfc3dcfb2daf73c15841f51c95f909225e7b8f9e4030d03bf7`。前端46 files/282 tests、typecheck、build、Rust前置检查及隔离raw启动/精确回收通过；正式安装/E5、多屏/混合DPI、长时运行、真实Codex额度仍未验。见 [G8-C-F7结果](evidence/G8-C-F7/result.md)。

## 当前重新打包候选：G8-C-F6（2026-10-04）

完成详情几何、关闭控件、Timer进度环、小尺寸、Codex调度与条上透明度滑块修复；fresh NSIS 与 final raw Release 隔离启动已通过。安装包：`evidence/G8-C-F6/cargo-target/release/bundle/nsis/Widget Platform_0.1.0_x64-setup.exe`，SHA-256 `56e8074912d75fa86842b8752a40feaa9607be29e0bacb382ed8cc735c1358b0`。raw EXE SHA-256 `01ba1ee4f7ac2bbcdfb491f8141e7d30d21220767f97fae5b44593113f065a46`。全前端46 files/278 tests、typecheck、Rust fmt/test/check及隔离profile/进程精确回收通过；正式安装/E5、真实Codex额度、多屏/混合DPI和长时运行仍未验。见 [G8-C-F6结果](evidence/G8-C-F6/result.md)。

## 当前重新打包候选：G8-C-F5（2026-10-04）

修复拖动期间四边目标缺失、左右预览横向、命中范围偏离可见框：开始即显示四边，按目标方向绘制紧凑灰色虚线，只有候选加深；真实释放时读cursor，不移动松手也回收。新包 `evidence/G8-C-F5/delivery/Widget Platform_0.1.0_G8C-F5_x64-setup.exe`，SHA256 `e004cebb153df8a9a591f7099acaba32e2fa271afe6b425007ea99e8a0cc5020`。全前端260/Rust147（4 ignored）、fresh NSIS及独立身份native四方向/47检查PASS；正式安装/E5与final raw同SHA桌面未验，由哥哥先退出旧实例再安装验收。仍为0.1.0未签名本机候选，不是稳定版。见 [结果](evidence/G8-C-F5/result.md)及[交付复核](evidence/G8-C-F5/delivery-verification.json)。下方均为历史包。

## 历史重新打包候选：G8-C-F3（2026-10-02）

修复从条外首次悬停预览遮挡：先准备native空间、真实尺寸重算、整体摘要栏向内侧锚定；补齐同尺寸ready复用和Esc恢复focus误触发。新包`evidence/G8-C-F3/delivery/Widget Platform_0.1.0_G8C-F3_x64-setup.exe`，SHA-256 `a93ab1b07794b85986031c1fabe46dcef22128aa92aa2d1526f9ef17c8f8e23f`。前端241/Rust146（4 ignored）、最终raw同SHA四边×1–4排16组合、50次快速切换、图标边界/重启/正常托盘回收PASS；仍0.1.0未签名本机候选、未覆盖安装/E5 UNVERIFIED。见[结果](evidence/G8-C-F3/result.md)和[交付复核](evidence/G8-C-F3/delivery-verification.json)。下方F2/G8-B是历史候选，不作为当前包。

## 历史重新打包候选：G8-C-F2（2026-10-02）

已按四项体验反馈修复：天气仅城市输入、默认一排和排数设置、悬停提示卡移开回收、Codex普通启动客户端发现。新安装包为 `evidence/G8-C-F2/delivery/Widget Platform_0.1.0_G8C-F2_x64-setup.exe`，SHA-256 `1711cc7b0ef07beb087a3674aa97928369971217e63b87a4cd149d035a7fd050`。前端223/Rust146（4 ignored）与fresh构建、最终raw EXE55项/重启/正常托盘回收具本机证据；未自动覆盖用户安装，重新安装体验仍待哥哥验证。仍是0.1.0未签名本机自用候选，不称稳定版。见[结果与复测清单](evidence/G8-C-F2/result.md)和[交付复核](evidence/G8-C-F2/delivery-verification.json)。下方G8-B包信息为历史候选。

Windows本地桌面信息与快捷交互工具的调研及开发工作区。

目标：长期常驻、低资源占用、内容可自定义、无需WSL2。**2026-10-02当前：G8-B已完成限定技术验收且哥哥接受仅本机自用候选限制；G8-C进行中，等待实际体验E5。** 设置入口缺陷已修复；G2–G7保持各自原结论，G5 partial，G8-A closed_with_unverified。24h/完整生命周期/外部/系统恢复等[延期项](evidence/G8-A/final-20261001-1814/deferred-acceptance.md)仍未验，旧短测不代表新包性能通过。已有同哈希冻结候选安装包，**不是正式稳定版或最终用户验收通过**；见 [G8-B结果](evidence/G8-B/result.md)、[接受决定](evidence/G8-B/candidate-decision.json)及[G8-C清单](evidence/G8-C/acceptance.md)。

## 从哪里开始

历史G8-B候选：version `0.1.0`、currentUser/x64、未签Windows代码签名、没有自动更新，依赖本机已有WebView2 Runtime；不公开/商业发布。最终installer SHA `3977b7340b360f1263eb6d2d2a4512c814f653d65fa92bfa499276dd4526fa12`，冻结包在 `evidence/G8-B/delivery/Widget Platform_0.1.0_G8B-F1_x64-setup.exe`。同版本重装保留数据已有证据，**跨版本升级没有通过证据**。本轮测试安装已卸载，原目录已元数据复核恢复；仅本机自用候选限制已获接受，E5实际体验尚未确认。

Luna或其他执行器先读[AGENTS.md](AGENTS.md)，再按[task_plan.md](task_plan.md)执行。G1-E 已选择 Tauri 为正式应用路线；路线证据、取舍和未验证条件见[决策记录](evidence/G1-E/decision.md)。用户已批准 [UI-D1 v2 原型](designs/widget-platform-reference-preview/Widget%20Platform%20UI%20Preview%20v2.html)作为既有 UI/UX 基线。根目录 [icon/](icon/) 是已批准的产品图形图标来源，43项 Lucide 固定commit来源核验及 `blocks.svg` 品牌决策见[来源证据](evidence/G2-UI-C/source-review.md)；图标已接入并完成[C3限定E1/E2](evidence/G2-UI-C/c3-20260930/result.md)，最终发布制品的完整随包许可/E3仍由G8-B复核。具体状态以task_plan及G8-A收口/延期清单为准。

| 文档 | 用途 |
|---|---|
| [产品需求文档](产品需求文档.md) | 产品目标、需求ID、范围、失败行为 |
| [架构说明](架构说明.md) | 已选后续宿主候选、数据/IPC/持久化/生命周期 |
| [开发短计划](开发短计划.md) | Goal 0–8、逐任务允许范围与验证 |
| [测试与验收标准](测试与验收标准.md) | 用例、E0–E5、性能协议、完成门槛 |
| [图标资源与替换验收](图标资源与替换验收.md) | `icon/` 的 43 项清单、天气状态语义、品牌候选与 UI-03 分关验证 |
| [task_plan](task_plan.md) | 当前任务、进度和下一步 |
| [findings](findings.md) | 事实、决策、风险和证据 |
| [AGENTS](AGENTS.md) | 开发与AI执行规则 |
| [项目调研报告](项目调研报告.md) | 源码级研究、替代方案、官方资料 |
| [项目评估](项目评估.md) | 原始目标与研究要求 |
| [调研验证记录](research/验证记录.md) | 固定源码、参考项目检查与未验证范围 |
| [G0-A 环境清单](evidence/G0-A/environment.md) | 当前工具链、桌面与显示器能力、构建缺口 |
| [G0-B 工作区记录](evidence/G0-B/workspace.md) | 根 Git 边界、研究副本提交/许可与忽略规则 |

原调研报告的按日建议保留为历史材料，当前开发顺序以Goal短计划和用户最新要求为准。

## 当前技术方向

G1-E 选择 Tauri 2 + TypeScript/Rust 作为后续独立产品候选；Zebar 因缺少现成的任意模块顺序配置而不直接采用，WPF 保留为原生对照。两路线 P0 当前工作阈值均通过，P1 样本已采但比较条件存在差异；不能由此宣称完整路线胜出或用户验收通过。详见 [G1-E 决策](evidence/G1-E/decision.md)。

基础内容模型：摘要区域 + 一个活动面板；各功能各自状态。初期不做插件市场、Event Bus、云同步或跨平台框架。

## 目录与运行说明

research中的codenotch/zebar/pillar是参考副本，不是本项目程序。不要在其中实现产品；原研究记录不等同本项目测试。

`prototypes/` 下的程序仍是 Goal 1 参考原型，不能作为正式产品入口。正式产品源码位于 `app/`；Todo/Timer/Media/CPU/RAM/GPU 已接入真实功能与状态。Goal 2–4 的完成不等于安装包或全项目验收。

### 本地构建与验证

在工作区根目录运行汇总检查：

```powershell
pwsh -NoProfile -File scripts/check.ps1
```

该脚本以 `app/` 为 JS 工作目录，并记录每条命令的 cwd、exit code 和日志到 `evidence/G2-A/check/<UTC时间>/`。要单独运行时：

```powershell
Set-Location app
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test -- --run
npm run build
.\run-msvc-rust.cmd cargo fmt --manifest-path src-tauri/Cargo.toml --check
.\run-msvc-rust.cmd cargo test --manifest-path src-tauri/Cargo.toml --locked
.\run-msvc-rust.cmd cargo check --manifest-path src-tauri/Cargo.toml --locked
.\run-msvc-rust.cmd npm run tauri -- build --no-bundle
```

`run-msvc-rust.cmd` 在进程范围选择 Rust 1.98.1 MSVC 工具链，并用 `vswhere` 定位 Visual C++ 工具；不修改系统 PATH。当前本地复用了 `prototypes/tauri-shell/.tools/` 中的忽略工具链，没有复制或更改该原型。换机器时需先准备 `rust-toolchain.toml` 指定的 MSVC 工具链、Visual C++ Build Tools、Windows SDK 和 WebView2。依赖版本写入 `package-lock.json` 与 `src-tauri/Cargo.lock`；npm 安装跳过生命周期脚本，当前锁文件上的 optional `fsevents` 安装脚本不会执行。

上面的 `--no-bundle` 命令只生成 `app/src-tauri/target/release/widget-platform-app.exe`，不打安装包。当前另有真实打包入口：在项目根执行 `powershell.exe -NoProfile -File scripts/release.ps1`，顺序完成前端/Rust回归、locked元数据、完整第三方notice收集和fresh NSIS构建，证据在 `evidence/G8-B/build/<UTC run>/`；本轮F1的独立输出见 `evidence/G8-B/settings-fix/build/20261002T020522016Z/`。安装后EXE包含Tauri的唯一UNK→NSS bundle标记变更，raw/installed两个SHA分开核对，见[G8-B结果](evidence/G8-B/result.md)。构建入口不自动授权真实数据访问、安装/卸载或公开发布。

G0-A的工具缺失基线是历史记录；后续工具链准备及wrapper以对应证据为准。根Git为 `main`，已初始化首个 commit 并推送到公开仓库 `Astyyym/widget-platform`；research各仓库独立且由根忽略，`evidence/` 不随仓库分发。G8-A五安全场景与退出回收仅覆盖原SHA；G8-B-F1本轮仅修改shell状态两行及相邻测试，已重建/验收新包，不继承旧性能PASS。发布未修改系统PATH，也未新增隐私访问。

## 接手指令

~~~text
Goal 0、G2–G4原范围已完成；G5 partial，G6/G7/G2-UI-C按各自已记录范围收口。G8-A closed_with_unverified及原失败/延期表保持；旧性能不回填新SHA。G8-B-F1最小修复后fresh回归与本机安装链路、图标/完整许可、原目录恢复有限定PASS；哥哥已接受仅个人自用候选范围，G8-B据此completed。G8-C in_progress等实际体验E5；跨版/24h/完整生命周期/外部/系统覆盖仍UNVERIFIED。先读取G8-B/result.md、candidate-decision.json和G8-C/acceptance.md，不扩大隐私/公开发布权限或提前宣布E5。G1-B/C/D缺口仍保留。
执行前阅读 AGENTS.md 和 task_plan.md，按当前任务卡范围工作；research 源码只读，不读取凭证或私人剪贴板。
记录实际运行环境、可验证项与缺口，给出证据路径和下一张任务卡。
~~~

## 已知限制

参考 Codenotch 的检查结果不代表本项目通过。G1-D的多屏WPF不能替代Tauri实体混合DPI/恢复；其他厂商/混合GPU、Agent产品桥/UI仍未覆盖。G8-B的本机安装链路、随包完整许可和图标已具本轮限定E3证据，但跨版本升级、其他机器、长期性能、完整生命周期、外部/系统覆盖、风险接受和最终E5仍有缺口，详见G8-B候选边界及G8-A延期清单。功能开发、任务收口、技术验收与用户体验通过分开记录。
