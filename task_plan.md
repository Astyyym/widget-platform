# 当前任务与 Goal 状态

## 当前执行：工作区体积治理（2026-10-06）

状态：**completed（第三项清理脚本 + 第一档回收已执行，释放 75.38 GB）。**

哥哥提出项目文件夹是否臃肿。审计结论：项目 71.8 GB / 196,039 文件，可再生构建产物 75.38 GB（按 clean-build 口径，含 `app/src-tauri/target`）。根因是每张任务卡各建隔离 Cargo target，`evidence/` 下同时存在 23 个 cargo-target/target-final，把 Tauri 依赖树重复编译 23 遍。

实际执行：
- 新增 `scripts/clean-build.ps1`：白名单回收可再生目录，默认 dry-run，`-Apply` 才删；强制保留 `prototypes/**/.tools`、`evidence/**/delivery`、证据文本、`research/`；不跟随目录联接、拒绝越界路径、删后复核；支持 `-SafestOnly`（跳过全部 Cargo target 树）。
- **发现并抢救唯一交付物**：F6、F7 安装包只存在于各自 `cargo-target` 内，两卡均无 `delivery/`。已复制到 `evidence/G8-C-F6/delivery/`（SHA `56e80749…1358b0`）与 `evidence/G8-C-F7/delivery/`（SHA `06acad69…f427b38`），逐字节复核一致。据此在脚本内加入**哈希级唯一性保护**：回收 target 树前检查其中每个安装包内容是否在树外存在，不存在则 STOP（exit 2）。按文件名判断不足，因为各卡安装包同名但内容不同。
- `-Apply` 实测：**126/126 目录删除成功，释放 75.38 GB**，删后复核 0 残留。
- 结果：项目 **71.8 GB → 3.8 GB**；`app/` 2.9M、`evidence/` 664M、`prototypes/` 3.0G（主要是保留的 `.tools` 2.87G）、`research/` 61M。D 盘已用由 414G 降至 346G。
- 保留项逐项复核通过：`.tools` 工具链、`app/run-msvc-rust.cmd`、源码、8 个交付安装包、`app/evidence/G3-B/todo-e2-result.json`、139 个证据 md、`research/验证记录.md`。`run-msvc-rust.cmd cargo --version` 返回 `cargo 1.98.1`，工具链仍可用。git 工作区干净（源码零改动）。
- `AGENTS.md` 新增「构建缓存与隔离验证的 target」规则（隔离验证复用 `app/src-tauri/target`、共用缓存目录、回收工具、交付包保留）与「脚本编码」规则（`scripts/*.ps1` 保持 ASCII）；并修正已过时的「根目录目前不是Git仓库」表述。
- findings 记录 F-114（体积审计与根因）、F-115（本机无全局 Rust 工具链，`.tools` 不可删）、F-116（PowerShell 5.1 编码与 List 解包、Write-Output 优先级陷阱）、F-117（唯一交付物陷阱与哈希级保护）。

未执行：`prototypes/` 源码（wpf-shell/zebar）去留未决，本轮保留。

## 历史执行：首次公开发布（2026-10-06）

状态：**completed（首次推送 + Release v0.1.0 已发布并复核）；真实桌面体验 E5 与未验证项边界不变。**

哥哥要求「推到 GitHub 上，同步更新 release」。执行前确认：根 Git 为 `main` 且**无任何 commit**，GitHub 上也不存在本项目仓库，因此这是首次发布而非增量同步。

实际：
- 仓库 `Astyyym/widget-platform`（public），首个 commit `d40f23c`，457 files / 17.5 MB，`main` 已跟踪 `origin/main`。
- 发布前审计发现原 `.gitignore` 会让约 34 GB 内容进入提交，其中 `prototypes/*/.runtime*` 的 WebView2 profile 含 `Login Data`/`Cookies`/`Session Storage`。已扩展忽略规则（`evidence/`、`app/evidence/`、`**/.runtime*/`、`*.tgz`、`*.pma`、`*.hyb`、`*.nvph`、`*.dat`、`__pycache__/`、`*.pyc`），推送后按远端 tree 复核 457 blobs、可疑路径 0。
- Release `v0.1.0` 资产 `Widget.Platform_0.1.0_x64-setup.exe`（GitHub 将空格改写为 `.`），4,471,581 B。下载回本地复算 SHA-256 `0bc1a3d7f11f374b585e7f0a0ea7c76ba54b734ebd0f2d138cac43157165e3c4`，与本地交付副本逐字节一致。
- 范围外未做：未自动安装、未改动系统 PATH、未新增隐私访问、未发布 raw EXE。

未验证（与发布前一致，不因发布改写）：多屏/混合 DPI、24h 常驻、跨版本升级、Codex 长时额度、正式安装 E5。

详见 [发布记录](evidence/publish-20261006/result.md)。

## 历史执行：天气折线图 / 媒体预览 / 定位反查（2026-10-05）

状态：**completed（实现 + 回归 + release EXE 打包）；真实桌面视觉由哥哥目视确认。**

哥哥本轮要求：小时预报改折线图（预览气泡显示城市+当天温度+天气+迷你折线；详情页折线从左到右生长动画、极值点标温度数字最高红最低蓝、折线下一行精简天气带）；折线横轴以当前时间为第 4 个点；详情页天气带隔点显示（折线保留 12 点、天气带只 6 点、无横向滑动条）；悬停预览改通用插槽 `ShellModule.previewContent`（其他 icon 可复用，纯展示）；媒体详情页按钮合并为三个（上一个/暂停播放切换/下一个）；定位成功反查城市名（到县级），失败回退「当前位置」；打包 release EXE。

实际：前端 `tsc` 干净、**50 files / 299 tests 全过**；Rust `cargo check --tests` 干净、weather 模块 **23 passed / 1 ignored**；经 `run-msvc-rust.cmd` wrapper 执行 `npm run tauri -- build --no-bundle` exit 0，release EXE 生成并冒烟启动成功。产物 `app/src-tauri/target/release/widget-platform-app.exe`（15,479,296 字节，SHA256 `2dc146cdfd30a51a52fe3f0bc503386ed34cb57d80058e20c539c5344fe4ea31`）。**NSIS 安装包**经项目规范脚本 `scripts/release.ps1` 全流程构建（13 步全 exit 0，含 rust-fmt 修正）→ `bundle/nsis/Widget Platform_0.1.0_x64-setup.exe`（4,471,581 字节，SHA256 `0bc1a3d7f11f374b585e7f0a0ea7c76ba54b734ebd0f2d138cac43157165e3c4`，currentUser/未签名），交付副本 `evidence/weather-chart-media-preview-20261005/delivery/Widget Platform_0.1.0_weather-chart_x64-setup.exe`。详见 [result.md](evidence/weather-chart-media-preview-20261005/result.md)。真实桌面视觉/交互（气泡折线密度、动画观感、媒体三按钮）由哥哥目视确认通过；定位反查实际返回由哥哥确认。手动搜索县级覆盖仍受 Open-Meteo 数据源限制。

## 历史执行：G8-C-F11（2026-10-05）

状态：**completed（修复 + 隔离 fresh Release 真实鼠标 E2 + NSIS 安装包）；正式安装/哥哥 E5 未执行。**

设置窗缩放根因：可见面板比真实窗口小 6px + 缩放手柄被面板圆角裁掉，「看得见的角」既触发不了原生缩放也触发不了 DOM 缩放。修复：面板贴边 100%/去封顶；手柄 `position:fixed` + `createPortal` 到 `document.body` 逃出裁切、角手柄 22×22 覆盖圆角。全前端 47 files/285 tests、typecheck/build、Rust fmt/test/release-check PASS；隔离 fresh Release 与正式打包 EXE 真实鼠标 E2 均通过（右下角 inset2 放大/缩小、东/西边，left/top 固定）。哥哥恢复外网后 `scripts/release.ps1` **完整重跑全绿**（13 步全 exit 0）。交付 `evidence/G8-C-F11/delivery/Widget Platform_0.1.0_F11_x64-setup.exe`（SHA `ecf835718034a1e106f9c79e01ab2a28ad6986ea1ee636e3935dbed384f87fba`），构建证据 `evidence/G8-C-F11/build-final/20261005T082522317Z/`。详见 [fix-result.md](evidence/G8-C-F11/fix-result.md)、[诊断](evidence/G8-C-F11/result.md)。哥哥当前安装版（2026-10-04，SHA `86eaaf43…`）不含修复，需卸载后装新包。

## 历史执行：G8-C-F10（2026-10-05）

状态：**implemented_unverified**。目标是修复设置窗右下角原生缩放命中与事件链：左上角固定、只改变宽高，不进入标题栏整窗拖动；设置窗口视觉样式明确不在范围内。F10先误改透明度，已立即撤回；当前 resize 区只接受左键并阻断事件冒泡，定向/全前端47 files/283 tests、typecheck/build和正式配置 fresh raw Release均通过。raw SHA `6f7f641492273ed88b24f25170ffc963505d59e7c947bf55afbc8f3dfdb76fed`。隔离真实鼠标E2/E3与正式体验E5尚未验证；不得把CSS测试/构建说成缩放桌面通过。

## 历史执行：G8-C-F9（2026-10-05）

状态：**implemented_unverified**。已移除导航网格的36px尾部占位；整个设置标题栏（排除窗口控制按钮）接入 native drag；增加 West/East 和底部角 resize-drag hit region 与最小化 settings resize capability；材质控件按普通/半透明/模糊玻璃条件显示。前端全量47 files/281 tests、typecheck/build、Rust既有验证及fresh raw Release通过，SHA `416f99a8933bf2ab96c529247b196d9f002e988c853e4c81c9a0740245c4dc81`。未运行隔离Release实际鼠标拖动/缩放，E2与E5保持UNVERIFIED。证据见[evidence/G8-C-F9/result.md](evidence/G8-C-F9/result.md)，合同见[evidence/G8-C-F9/plan.md](evidence/G8-C-F9/plan.md)。

## 当前执行：G8-C-F8（2026-10-05）

状态：**implemented_unverified**。已完成透明度从导航条移入外观设置、普通背景/半透明/模糊玻璃材质、0–32px模糊强度、旧配置兼容和导航条轻阴影；定向19/19、全前端47 files/281 tests、typecheck/build、Rust fmt/test/check及fresh raw Release通过。真实 Windows Release 的材质切换/视觉与哥哥正式安装E5尚未验，结果见[evidence/G8-C-F8/result.md](evidence/G8-C-F8/result.md)，合同见[evidence/G8-C-F8/plan.md](evidence/G8-C-F8/plan.md)。

## 历史执行：G8-C-F6（2026-10-04）

状态：**completed（F6原六项与F7本轮导航/进度条调整、回归、fresh NSIS与隔离 final raw Release 通过；E5正式安装/哥哥手动体验未验）。** F7新增：透明度控件脱离模块卡片层；两侧白条按厚度和方向联动；CPU/GPU/内存/Codex额度及专注/休息预览与详情使用已用进度条；Timer详情按状态只保留状态动作+重置两个按钮。F7全前端46 files/282 tests、typecheck、build、Rust前置检查通过；raw SHA `a72f326464fb1cbfc3dcfb2daf73c15841f51c95f909225e7b8f9e4030d03bf7`，installer SHA `06acad690789d29f6d7ea1bf1b1551513ec421d4b6e5fbcee0a351779f427b38`。未自动安装、停止正式实例或读取真实额度/私密数据。详见[evidence/G8-C-F7/result.md](evidence/G8-C-F7/result.md)。

## 历史执行：G8-C-F5（2026-10-04）

状态：**completed（本卡修复、限定E1/E2与fresh包）；G8-C整体/正式安装/E5未验，交给哥哥验收。**

按 [执行合同](evidence/G8-C-F5/plan.md) 串行恢复拖动开始四边可见、按目标方向计算紧凑矩形、绘制/命中统一及结束回收。F4“未命中0个/命中1个”被本次明确指令替换，其历史测试与未验边界不改写。只改 shell 与相邻测试，不自动安装或访问正式数据。

实际：全前端260/Rust147（4 ignored）、typecheck/build/fmt/release check、fresh NSIS通过；独立身份真实Win32四方向/47检查通过，仅5安全模块/1排/144 DPI，非final raw同SHA或安装验收。169基线164不变/5修改+3新建；交付 `evidence/G8-C-F5/delivery/Widget Platform_0.1.0_G8C-F5_x64-setup.exe`，SHA `e004cebb…0cc5020`。11个自有进程精确回收，9251无监听、哥哥PID18084保留；不是正常托盘退出。详见 [结果与边界](evidence/G8-C-F5/result.md)。下一步哥哥退出旧实例、安装并验收，无新功能任务。

## 历史执行：G8-C-F4（2026-10-03）

状态：**implemented_unverified；主/悬停/详情/设置隔离真实窗口已验证，拖动预览真实桌面矩阵与E5未验证。**

目标：收缩主摘要、悬停概况、活动详情、拖动目标与独立设置窗口的原生透明边界，消除微信截图暴露的大透明矩形；保持业务与权限边界不变。

阶段门：
1. `completed`：主摘要/悬停/活动详情/设置尺寸链收缩，隔离真实窗口读回通过；
2. `completed`：前端与Rust回归、fresh Release通过；
3. `implemented_unverified`：拖动预览真实Win32矩阵与安装后E5待补。

旧“目标外松手按释放位置贴最近边缘”、设置“沿边位置”控件和“天气不提供自动定位入口”均已被本轮需求替换，不再作为验收规则。旧 G8-C-F3 结果只保留为历史，不回填本轮任何阶段。

本轮结果：见 [G8-C-F4结果](evidence/G8-C-F4/result.md)。主窗口compact为624×108 logical，悬停为624×203.3 logical，活动详情为624×150 logical，独立设置为620×520 logical；均为隔离 fresh Release E2 读回。拖动预览实现改为未命中0个、命中1个，真实桌面矩阵未在本轮重跑。

证据目录：`evidence/G8-C-F4/`。

## 最新执行：G8-C-F3（2026-10-02，completed：修复/本机验证/重新打包）

哥哥明确“开始修复吧”后，按[G8-C-F3合同](evidence/G8-C-F3/plan.md)完成首入就绪/真实尺寸/整体dock锚定/宿主预留与intent revision；新增Esc恢复focus不制造hover补漏并重建重测。全前端241/Rust146（4 ignored）及fresh构建PASS；独立ID和最终raw同SHA各四边×1–4排16组合，最终50次35ms快切、34/52图标×1/4排、重启保持、三次正常托盘各7进程回收PASS。187基线183不变、4修改+3新建；installer SHA a93ab1b0…8f8e23f，交付`evidence/G8-C-F3/delivery/Widget Platform_0.1.0_G8C-F3_x64-setup.exe`。最终raw SHA1b24412c…71cbaad；三env一致且KnownFolder/自有库目录读回在隔离profile，不读写正式数据，不自动安装。E5/旧延期项保持UNVERIFIED，下一步哥哥实际安装体验。见[结果](evidence/G8-C-F3/result.md)、[交付复核](evidence/G8-C-F3/delivery-verification.json)。

## 最新检查：G8-C-F3-D（2026-10-02，completed：仅诊断/修改方法）

哥哥报告并给出可重复规律：条外首次移入会遮挡、图标间切换基本正常；本轮仅授权检查原因与提出方法，不改产品代码或重打包。三轮隔离native E2均记录compact高124时preview top12，扩至240后仍top12，切换图标才重算到75；当前条bottom80，切换后仍有5px压边。源码证实先算后扩窗、ResizeObserver未重定位、图标边界代替整条边界，另有固定window/预览尺寸风险。见[诊断与修改方法](evidence/G8-C-F3-diagnosis/result.md)、[原始几何](evidence/G8-C-F3-diagnosis/geometry-diagnosis.json)。自有7进程精确回收、9246无监听、用户安装PID17428仍运行；未点歧义托盘、未读私密模块。五个悬停关联源文件哈希不变，用户实际体验该定位项FAIL，前轮F2回收/55项范围历史不改；下一步是shell有界实施修复及新增不相交验收，尚未实施。

## 最新执行：G8-C-F2（2026-10-02）

**G8-C-F2 completed（四项本机修复与重新打包范围），G8-C仍in_progress待哥哥重新安装体验E5。** 城市名称替代手工坐标/时区；默认一排与1–4排持久设置；鼠标移开自动消失的是悬停提示卡，不影响点击活动面板；Codex发现已安装原生客户端，不再依赖测试路径变量。前端223/Rust146（4 ignored）、fresh NSIS、最终raw Release同SHA55项/重启保持/正常托盘三启动各7进程回收、600 notice payload文件、180基线16修改/164不变+3新文件及交付哈希复核PASS。最终installer SHA `1711cc7b…a7fd050`，交付 `evidence/G8-C-F2/delivery/Widget Platform_0.1.0_G8C-F2_x64-setup.exe`。Codex真实fresh两额度行/来源已在独立native EXE观察；readonly invoke导致计数探针未安装，原计数FAIL保留，精确次数UNVERIFIED，不为修探针重读。最终raw（69f352…52e34）隔离存储验证不等于新installer实际安装；没有自动重装或读取正式数据，旧跨版/24h/混合DPI等保持UNVERIFIED。见[结果](evidence/G8-C-F2/result.md)、[交付复核](evidence/G8-C-F2/delivery-verification.json)。以下G8-B冻结SHA为历史候选，不作为本轮交付SHA。

更新：2026-10-02（+08:00）｜**G8-B completed（仅哥哥已明确接受的本机自用候选范围）；当前G8-C in_progress / 等待实际体验反馈，E5 UNVERIFIED。** 设置入口产品缺陷已最小修复并以fresh包取得有效页面读回；全前端216/Rust138（3 ignored）、五安全模块导航、草稿、重启/同版重装/卸载保留数据、托盘回收、图标/600许可文件、19项父复核PASS。新installer SHA `3977b734…4526fa12`已冻结；原目录元数据恢复PASS、备份/产品进程/注册/快捷方式为空，原正文未读。见 [G8-B结果](evidence/G8-B/result.md)、[接受决定](evidence/G8-B/candidate-decision.json)、[G8-C清单](evidence/G8-C/acceptance.md)。G8-A仍closed_with_unverified；原suite失败及延期项不改PASS，旧性能不回填新SHA。跨版/24h/完整生命周期/外部/系统覆盖仍UNVERIFIED；仅接受个人自用候选，不公开发布、不扩大隐私或系统干预权限。

## 1. 当前有效指令

2026-10-02本轮边界决定：哥哥在明确列出跨版本升级、24h/完整生命周期、外部模块/系统恢复未验证及未签名/无自动更新后，答复 **“接受限制，作为本机自用候选进入 G8-C”**。G8-B按具体限定自用范围completed，完整RELEASE-01不改PASS；G8-C in_progress，先给Todo/专注/CPU/GPU/内存及设置/托盘简短清单和同哈希最终包。用户实际体验尚未反馈，E5 UNVERIFIED；不自动启动原配置、不公开发布或新增私人数据/系统干预。见[candidate-decision](evidence/G8-B/candidate-decision.json)。下条“待候选决定”是同轮决定前历史，以上述范围为最新状态。

2026-10-02本轮最新执行：哥哥要求按“补G8-B技术验收→明确候选边界→G8-C体验验收”执行。本轮 **G8-B-F1 completed（限定E1/E3），G8-B总卡in_progress / 待候选限制决定；G8-C not_started**。已复现活动面板内设置入口被忽略，确认偏离获批原型，仅修 `shell-view.ts` 两行并在相邻测试加9例；RED→GREEN、全前端216/Rust138（3 ignored）、fresh NSIS、五安全模块面板→设置、Todo草稿、重启/同版重装/卸载保留测试数据、正常托盘退出、600许可文件与图标、19项父复核均PASS。新installer SHA `3977b734…4526fa12`，新安装EXE SHA `683d09f4…0d59fe`；旧性能证据不回填新SHA。两个原目录已恢复且独立元数据一致，备份/进程/注册/快捷方式为空，未读原正文。见 [G8-B结果](evidence/G8-B/result.md)、[候选边界](evidence/G8-B/candidate-boundary.md)、[父复核](evidence/G8-B/settings-fixed-independent-review.json)。跨版本升级、24h及原延期表保持UNVERIFIED，用户接受边界前不启动G8-C、不公开发布。下列较早指令/状态为历史，以上述本轮结果为准。

2026-10-02：哥哥要求“继续执行G8-B”。当前任务 G8-B in_progress；按本轮合同先许可/打包配置、回归/fresh构建，再执行已授权本地安装链路。允许临时改名隔离正式 identity 两个精确数据目录，禁止读取原库正文，测试后按元数据恢复。正式发布风险问题被跳过，不能把安装许可扩大为接受 G8-A 全部延期风险或公开发布；旧未验项原样保留。

2026-10-02恢复补完：哥哥问“接下来要怎么做”，优先完成此前已授权但被工具上限中断的原数据恢复。同盘 synthetic 演练通过后执行修正脚本，两个正式目录恢复到原名称，独立核对元数据一致、备份剩余0、本项目进程为空；测试数据保留在C盘同级目录，不再跨盘rename到D盘。没有读取原库正文、重新启动或重新安装应用。证据见 [独立读回](evidence/G8-B/restore-readback.json)。下一项是G8-B候选证据汇总及设置入口有界诊断，不启动G8-C或公开发布。

最新收口指令：哥哥明确说 **“已从任务托盘退出，可以关闭G8-A了，同步更新项目文档”**。本轮任务按用户决定关闭，并保留未验项；不是PERF/LIFE全项PASS，不自动扩大到打包、安装/卸载、发布或新的数据访问。下一项为交付准备；正式阶段门与延期补测/发布范围决定仍须分别满足。下列2026-10-01续行指令保留为历史，以本条和顶部实际读回为当前状态。

2026-10-01最新指令：哥哥要求按截图流程执行：**先查清场景状态变化 → 重跑受影响P0/P1并继续P2/P3/P6和安全生命周期 → 安全范围通过后交付准备 → 最终候选稳定后集中确认延期测试授权并实跑24h**。旧授权问题不提前反复询问，旧失败不跳过、不放宽断言。交付准备可整理打包方案/许可/构建脚本/文档，延期项始终UNVERIFIED；正式G8-B仍遵守阶段门。STATE1原始19:27来源随后获哥哥确认“有，我自己开了这三个icon”，为用户主动配置，归因阻塞解除；不以未复现冒称产品已修、不扩大到20:54输入来源。SAFE2新run正式重测，采样中不操作测试挂件的说明已给哥哥；不屏蔽/锁全局输入。

2026-10-01最新指令：哥哥要求“继续做G8-A直至完成”，恢复连续执行而非逐卡停止。最终收口合同见 `evidence/G8-A/final-20261001-1814/plan.md`；先安全前置/范围内bug修复，再统一最终Release的P0–P7与真实24h、恢复/生命周期/SEC核验，不启动G8-B/C。具体24h、外部模块、Clipboard和断网/睡眠授权表单尚未回答，未推定授权；安全隔离测试继续，高风险门槛必须补齐真实授权与证据才能关闭。

2026-10-01续行收口：G8-A-DEV1普通dev入口超时已复现并按合同最小修复，见 `evidence/G8-A/dev1-20261001-1650/result.md`。优化扫描排除不限制文件监听，实际watcher进入app/evidence历史构建输出；只加server.watch排除，不盲清cache/升级依赖、不使用noDiscovery。真实默认入口首次启动/重启、强制重新依赖优化补充、浏览器/HMR与完整前端回归通过。shell/业务/权限不变；下一未关闭边界为Show原尺寸/焦点语义，P2/P3本卡未恢复。

2026-10-01接手授权：哥哥确认其他执行窗口已暂停，ShellFrame.tsx、shell-view.ts及shell-view.test.ts由本执行者独占接手。G8-A1-F2-R1已完成接手复核与补漏，保留接手前188测试及70972fbe…制品/限定E2历史，不直接沿用其completed结论。新增10项真实组件handler/可控native promise E1回归，生产只改ShellFrame.tsx，另两接手文件字节不变；合同/接手基线见 `evidence/G8-A/f2-20261001-1235/review-20261001-1405/plan.md`。后续普通dev已由DEV1独立收口；P2/P3本卡未恢复。

2026-10-01最新优先级：哥哥要求“先解决已存在的问题”。暂停新增P2/P3，先执行G8-A1-F2点击丢失诊断/产品修复，再单独处理普通dev入口超时。F2合同在 `evidence/G8-A/f2-20261001-1235/plan.md`；只允许shell领域与对应测试的有证据最小修复，不把加长runner等待当产品修复。高风险读取/24h权限不扩大，G8-B/C不启动。

G8-A1-F2当前状态（2026-10-01）：上一轮并发阻塞已解除；接手前按下保护仍漏掉已启动的native promise及模块外释放，R1已通过四轮RED→GREEN补齐。新SHA同PID100次完整原节奏及20次真实鼠标、正常退出/回收PASS；不拼接前版超时尾段，不以runner加等待当修复。Show恢复焦点的原同rect断言仍UNVERIFIED；普通dev由DEV1独立收口，P2/P3本卡未恢复。旧失败、接手前fixed结果与本轮review结果分别保留，见 `evidence/G8-A/f2-20261001-1235/`。

当前执行状态：G8-A **closed_with_unverified**；G8-B-F1技术验收完成，G8-B按已接受本机自用候选范围completed；G8-C in_progress待体验E5。跨版/24h等仍UNVERIFIED、无公开发布权限；原数据元数据恢复PASS，详见顶部与G8-B决定/G8-C清单。

2026-09-27 追加授权边界：仅对网易云当前播放会话发送了一次 pause，并发送一次 play 恢复；两次均 accepted，最终为 playing。没有对当前媒体会话做切歌、seek、关闭或异常注入。此次结果不满足 provider false/exception 门槛，证据见 `evidence/G4-B3/live-failure-attempt-20260927.json`。

2026-09-27 Edge 关闭页探测阻塞在发送输入之前：已确认当前选中的 Edge 媒体会话与 Edge 窗口标题匹配；`SetForegroundWindow` 与按 PID `AppActivate` 都未使 Edge 成为前台，前台守卫仍为 PID 13224（Edge PID 28612）。未发送 pause 或 Ctrl+W，也未关闭网页。详细记录见 `evidence/G4-B3/attempts.md`。

2026-09-27 用户将浏览器放到前台后，预检确认 Edge 是前台进程，但当前标签标题与应用选中的 Edge 媒体会话不匹配。为避免关闭错页，未发送 pause 或 Ctrl+W；需用户切换到实际承载该媒体会话的 Edge 标签后再继续。未保存标题或媒体正文，详见 `evidence/G4-B3/attempts.md`。

2026-09-27 用户报告并明确验收：视频播放时可通过应用暂停、播放、下一集；关闭网页后应用中的视频媒体会话消失，重新打开网页后会话重新出现。用户指示将 G4-B3 记为通过并继续 Goal 4。记为该范围 E5 用户验收；provider `false`/异常未观察到，作为被用户接受的 E2/E4 覆盖缺口保留。

Goal 0已完成。Goal 1 当前只允许路线原型和证据。G1-A 在原型目录内隔离运行官方 Zebar；G1-B 自身历史 P0 内存与整体性能状态仍为 UNVERIFIED。G1-D 后续对选定的 Tauri 最终候选完成了独立 P0/P1 采样，P0 当前 CPU/Private Working Set 门槛通过；该证据不回写成 G1-B 原任务通过。G1-C 的单屏几何/输入验证已完成，多屏和恢复场景仍有缺口。没有建立正式 app、没有读取凭证/剪贴板、没有注册开机启动或改全局配置。

## 2. 文档交付

| 文档 | 状态 | 说明 |
|---|---|---|
| 产品需求文档.md | 已编写 | 范围、需求ID、失败/隐私/性能语义 |
| 架构说明.md | 已编写 | 候选路线、数据/生命周期、目录契约 |
| 开发短计划.md | 已编写 | Goal 0–8与逐任务卡 |
| 测试与验收标准.md | 已编写 | 用例、E0–E5、真实测量与证据模板 |
| task_plan.md | 已编写 | 当前状态，不能提前勾选开发 |
| findings.md | 已编写 | 研究事实、决策、未知 |
| README.md | 已编写 | 导航与接手入口 |
| AGENTS.md | 已编写 | 执行边界、修改范围、状态诚实 |

文档编写不等于产品验收。初版曾检查 30 张任务卡（当时新增 G2-UI-A/B），该计数是历史记录，不涵盖后续新增卡；旧文档链接与编码复查见 [UI-D1 记录](evidence/UI-D1/result.md)。文档检查不算产品测试。

## 3. Goal 总览

| Goal | 目标 | 状态 | 前置 / 下一步 |
|---|---|---|---|
| Goal 0 / G0 | 环境与工作区准备 | completed | G0-A/G0-B证据见 evidence/G0-A、evidence/G0-B；G1-A 已完成 |
| Goal 1 / G1 | 技术路线验证 | in_progress（暂缓） | G1-A 已完成，G1-E 已完成；G1-B/C/D 仍有未验证项；按哥哥指示暂不推进，不作为 G5 前置 |
| Goal 2 / G2 | 产品骨架与已批准 UI/UX 基础界面 | completed（原范围及G2-UI-C实施卡） | G2-A、G2-UI-A、G2-UI-B、G2-B、G2-C历史completed；G2-UI-C C1/C2 E1与C3原生图标/真实桌面E2 PASS，发布制品/E5仍由G8验证 |
| Goal 3 / G3 | Todo与Timer | completed | G3-A/B/C/D/E 均已完成；G3-E 修复摘要重连状态与 retryable 建连失败重试，真实故障恢复/静默 listener 断线检测仍 UNVERIFIED |
| Goal 4 / G4 | Media与CPU/RAM | completed | G4-A、G4-B、G4-C completed；G4-B3 按用户 E5 验收关闭，provider false/异常 E2/E4 未覆盖并作为用户接受的范围限制记录 |
| Goal 5 / G5 | Codex/Hermes可靠数据 | partial（2026-09-28 按哥哥明确范围收口；不等于 E2/E4 全项通过） | G5-A E1、G5-B 后端 E1/E4 completed；G5-B-UI E1、真实成功路径与托盘退出 E2 PASS，在线失败降级 E2/E4 UNVERIFIED；G5-C partial，Agent 桥/UI 不纳入本轮。详情见 [G5-B-UI 结果](evidence/G5-B-UI/result.md) |
| Goal 6 / G6 | Weather/文本Clipboard | **completed（保留明确未验证边界）** | G6-A/B/C1/C2/C3 完成；哥哥 E5 确认自动监听、实时历史、面板关闭后继续记录、复制/删除及最终 UI；真实写回当前剪贴板、重启持久化和正常托盘退出未单独验证，不阻塞本轮产品范围收口 |
| Goal 7 / G7 | GPU 能力 | completed（保留机型边界） | G7-A1/A2 GPU adapter、进程级预算、PDH 整卡显存与 engine 已完成并有真实 RTX 4060 E2/E4；硬件温度能力已按用户要求移出当前产品范围。 |
| Goal 8 / G8 | 性能、打包与用户验收 | in_progress（G8-A closed_with_unverified；G8-B限定自用候选completed；G8-C待体验E5） | [G8-B结果](evidence/G8-B/result.md)、[接受决定](evidence/G8-B/candidate-decision.json)、[G8-C清单](evidence/G8-C/acceptance.md)；新SHA不继承旧性能PASS，原延期项保持 |

2026-09-29 新增需求（仅文档规划）：哥哥指定根目录 `icon/` 作为所有产品图形图标的替换来源；归入 G2 新补充卡 **G2-UI-C**，状态 `not_started`。G2 原已完成卡及其历史 E1/E2 结论不撤销，也不把新卡标为完成；G8 仅复核最终制品。此次未改应用代码、原型、图标文件或已运行制品。

G6/G7不是首版默认必选。若用户批准跳转到独立Goal，记录指令与未关闭门槛，保持原Goal真实状态。

## 4. 子任务登记

| Goal | 子任务ID | 当前状态 | 证据 / 阻塞 |
|---|---|---|---|
| G0 | G0-A环境 | completed | [结果](evidence/G0-A/result.md)，ENV-01 PASS；路线工具缺口见环境清单 |
| G0 | G0-B工作区 | completed | [结果](evidence/G0-B/result.md)，根Git/忽略边界检查完成 |
| G1 | G1-A Zebar最小对照 | completed | [结果](evidence/G1-A/result.md)，官方 Zebar 3.3.1 真实窗口/输入 E2 PASS；任意排序有差距 |
| G1 | G1-B Tauri空壳与基线 | implemented_unverified | [结果](evidence/G1-B/result.md)；SHELL-01 PASS；P0 CPU 子项 PASS，内存/总体 UNVERIFIED |
| G1 | G1-C几何与输入原型 | implemented_unverified | [结果](evidence/G1-C/result.md)；单屏 SHELL-02 与 SHELL-03 E2 PASS；多屏/混合 DPI/SHELL-04 UNVERIFIED |
| G1 | G1-D WPF同内容对照 | implemented_unverified | [结果](evidence/G1-D/result.md)；Release、5/5测试、多个E2交互子项和WPF/Tauri P0/P1 E3样本完成；托盘、完整SHELL-01/03、恢复仍缺，P1比较条件有显示器/进程限制 |
| G1 | G1-E路线门槛与短计划修订 | completed | [决策](evidence/G1-E/decision.md)；选择 Tauri 作为 G2 候选；G1-D 与跨显示器/恢复限制仍按未验证处理 |
| 设计 | UI-D1 参考视频交互原型及评阅修订 | completed | [结果](evidence/UI-D1/result.md)、[统一尺寸检查](evidence/UI-D1/sizing-browser-result.json)；HTML v2 浏览器交互 E1 PASS，用户已批准设计资产；Tauri/native 与产品用户验收 UNVERIFIED |
| G2 | G2-A 正式骨架与检查入口 | completed | [结果](evidence/G2-A/result.md)；VERIFY/RELEASE E1 PASS、SEC-01 E0 PASS；Release `63DAFE33…124EAC1` 托盘 Show/Exit、隐藏恢复与菜单退出清理 E2 PASS |
| G2 | G2-UI-A 外观与安全布局 | completed | [结果](evidence/G2-UI-A/result.md)；类型检查、7/7 单测、生产构建 E1 PASS；Edge/CDP 几何矩阵 72/72 PASS，截图与 UI-D1 v2 对照 PASS；Windows/Tauri DPI 仍 UNVERIFIED |
| G2 | G2-UI-B 四边交互与活动面板 | completed | [结果](evidence/G2-UI-B/result.md)；E1 fixture 8/8、19/19 单测；Release `63DAFE33…124EAC1` 原生宿主 E2 16/16；同 SHA 的 tray Show/Exit 见 G2-A E2 |
| G2 | G2-B 设置与内容入口 | completed | [task result](evidence/G2-B/retry-non-efs/b2-e2-persistence-result.json)；Rust 8/8、TS 28/28、typecheck/build PASS；固定 Release E2 13/13，包含重启一致与锁定写失败保留旧字节 |
| G2 | G2-C IPC与模块生命周期 | completed | [结果](evidence/G2-C/result.md)；TS 35/35、Rust 12/12；Release-profile 原生 IPC/LIFE E2 8/8；最终无 feature Release 构建、探针剔除及同 SHA tray E2 通过 |
| G3 | G3-A Todo存储与命令 | completed | [结果](evidence/G3-A/result.md)；Rust fmt PASS，23/23 单测 PASS，release check PASS；TODO-01/02/03 E1 PASS，E2 留给 G3-B |
| G3 | G3-B Todo面板 | completed | [结果](evidence/G3-B/result.md)；typecheck、43/43 前端单测和生产构建 PASS；真实 Release E2 覆盖添加/完成/删除/键盘排序/鼠标拖动/重启保序，以及独占数据库锁拒写、草稿保留和解锁后单次重试 |
| G3 | G3-C Timer纯状态与持久化 | completed | [结果](evidence/G3-C/result.md)；Rust fmt PASS，33/33 全量单测 PASS，release check PASS；TIMER-01 E1 PASS |
| G3 | G3-D Timer面板与桌面反馈 | completed | [结果](evidence/G3-D/result.md)；typecheck、43/43 前端单测、生产构建 PASS；真实 Tauri UIA 9/9 PASS；独立 Release 真实 S3 睡眠跨 deadline、单阶段完成、重开和重启同 completionId 的 E2/E3 PASS |
| G3 | G3-E Todo摘要状态接入 | completed | [结果](evidence/G3-E/result.md)；模型 8/8、Todo 子套件 13/13、前端 72/72、typecheck/build PASS；首轮隔离 E2 验证计数读数，复核版 E2 只验空列表；真实故障恢复与静默 listener 断线检测仍 UNVERIFIED |
| G4 | G4-A Media原生桥 | completed | [结果](evidence/G4-A/result.md)；E1 46/0/1、Release check PASS；真实网易云+Edge E2/E4 双会话切换、暂停、关闭/移除、历史封面失败、零 ID 抖动及干净停止通过 |
| G4 | G4-B Media交互 | completed | 前置 G4-A 已完成；媒体入口、会话面板及按会话能力控制完成；真实成功路径 E2/E4 通过，用户报告视频页控制与会话关闭/恢复并明确 E5 验收；provider false/异常 E2/E4 未观察到，作为接受的覆盖限制保留 |
| G4 | G4-C CPU/RAM | completed | 前置 G2 已满足；G4-C1/C2 均完成，E1/E2/E4 证据见子卡结果 |
| G5 | G5-A 额度DTO、离线兼容与只读状态卡 | completed（E1） | 前端 92/92、typecheck/build PASS；Rust 52/0/1、fmt/check PASS；[结果](evidence/G5-A/result.md) |
| G5 | G5-B 原生 Codex 读取 | completed（E1/E4） | [结果](evidence/G5-B/result.md)；scratch 与产品 Rust 路径 CODEX-02 E4 PASS；Rust 全量 66/0/2、fmt/debug/release check PASS；UI 接线/窗口验收另排 |
| G5 | G5-B-UI Codex 面板接线与窗口验收 | partial（E1 PASS；真实额度成功路径已观察；正常托盘退出 E2 PASS；在线失败降级 E2/E4 UNVERIFIED） | 额度读取授权已消耗，不重读；正常托盘退出结果见 [tray-exit-20260928.json](evidence/G5-B-UI/tray-exit-20260928.json)；[结果](evidence/G5-B-UI/result.md) |
| G5 | G5-C Agent 状态最小桥 | partial（E1 reducer PASS；单 turn Hook 源事件观察 PASS；哥哥于 2026-09-28 明确接受本轮保持 partial，产品桥/UI 不纳入本轮 G5 收口） | `sessionId` 语义不变；真实 E4 仅证明 Hermes 当前 CLI 提供白名单字段，不等同产品接线。Hook 配置和精确许可已回滚。见 [能力核验](evidence/G5-C/capability-review.md) 与 [真实 Hook 结果](evidence/G5-C/hook-live-result.md) |
| G6 | G6-A Weather | completed | [结果](evidence/G6-A/result.md)；前端 140/140、Rust 92/0/3、fmt/typecheck/build/debug/release check PASS；固定公共坐标真实查询 1/1 PASS；未读取用户位置 |
| G6 | G6-B 文本剪贴板合同与安全测试 | completed | [结果](evidence/G6-B/result.md)；定向 16/16、全 Rust 108/0/3、fmt/release/diff check PASS；三轮独立审查无剩余阻断；未调用系统 Clipboard |
| G6 | G6-C 文本监听/存储/界面 | **completed（E1 + 用户 E5；保留未验证边界）** | C1/C2/C3 完成；Clipboard 模块显示即监听、面板实时刷新、关闭面板后继续记录、复制/删除、单滚动条、历史数量横向控件、两行预览均已验证；前端 154/154、Rust 132/0/3、typecheck/build/fmt/Release check PASS。真实写回当前剪贴板、重启持久化和正常托盘退出未单独验证。证据见 `evidence/G6-C2/result.md`、`evidence/G6-C3/result.md` |
| G7 | G7-A GPU | completed | G7-A1/A2 completed。目标样本 Intel i7-13700H + NVIDIA RTX 4060 Laptop GPU；GPU 真实 adapter/LUID、进程级预算、PDH 整卡显存/engine 已验证；硬件温度不再属于当前产品范围。 |
| G7 | G7-A1 DXGI adapter/显存进程预算语义 | completed | [历史结果](evidence/G7-A1/result.md)；真实 RTX 4060 adapter/LUID、专用/共享进程预算面板已验证。 |
| G7-A | G7-A2 PDH 整卡显存/engine | completed | [历史结果](evidence/G7-A2/result.md)；真实隔离 Release 读到 RTX 4060 整卡 dedicated 2.7 GiB、shared 0.1 GiB、engine 67.3%，LUID 匹配和 cleanup 通过。其他厂商/远程/混合 GPU 未验证。 |
| G7 | G7-final GPU 摘要与温度范围收口 | completed | [最终结果](evidence/G7-final/result.md)；当前源码 fresh Release SHA `a9072a14f43237ce3b136c8330ed9d67ffa7cdcb4586f45f1a16f18daa4dae9a`，UIA 读回 GPU 3%、CPU 10%、无温度模块；前端 158/158、Rust 137/0/3、fmt/typecheck/build/release check PASS。 |

| G8 | G8-A性能、G8-B制品、G8-C用户验收 | G8-A closed_with_unverified；G8-B限定自用候选completed；G8-C in_progress / E5 UNVERIFIED | [G8-B结果](evidence/G8-B/result.md)、[接受决定](evidence/G8-B/candidate-decision.json)、[G8-C清单](evidence/G8-C/acceptance.md)；跨版/24h等仍UNVERIFIED，无公开发布/新增隐私权限 |
| G8 | G8-B-F1 设置入口诊断与修复 | completed（本卡限定E1/E3） | [修复合同](evidence/G8-B/settings-fix-plan.md)、[19项父复核](evidence/G8-B/settings-fixed-independent-review.json)；生产仅shell-view两行、测试9例；fresh installer SHA3977b734…4526fa12；两原目录恢复、精确安装及进程已回收 |
| G8 | G8-C 用户体验验收 | in_progress（E5 UNVERIFIED） | [四条清单及固定制品](evidence/G8-C/acceptance.md)；只做已接受自用候选范围，等待实际体验反馈；修复影响制品则fresh重建/受影响复测 |
| G8 | G8-A1/F1/SEC 测量判定、同会话草稿及安全短测 | completed（本卡限定E1/E2/P0/P1局部E3，不关闭G8-A） | 前端187/187、Rust138/0/3；同SHA/PID两场景各121样本；100 Todo重开、安全五模块合计100面板+100设置、托盘/7进程回收PASS。首轮34次后点击缺失与第42轮诊断保留；稳定等待后全新100+100重跑PASS，快速物理点击未验。下一卡G8-A2未启动 |
| G8 | G8-A2 P2/P3与模块启停合同 | closed_with_unverified（P2/P3限定E2/E3通过；完整模块启停移延期D-LIFE） | [原合同](evidence/G8-A/run-20261001-0810/g8-a2/plan.md)、[本轮收口](evidence/G8-A/final-20261001-1814/closure-20261002.md)；保留原协议及完整LIFE未验边界 |
| G8 | G8-A1-F2 点击丢失产品修复 | completed（E1与限定E2，F2不关闭G8-A） | [F2结果](evidence/G8-A/f2-20261001-1235/fixed/result.md)、[验证JSON](evidence/G8-A/f2-20261001-1235/fixed/verification.json)、[独立审查](evidence/G8-A/f2-20261001-1235/fixed/independent-audit.json)；新SHA `70972fbe…d2a2e720`，100次Win32 mouse_event点击读回PASS；P2/P3暂停，普通dev另卡 |
| G8 | G8-A1-F2-R1 接手异步/释放生命周期补漏 | completed（本卡限定E1/E2，不关闭G8-A） | [结果](evidence/G8-A/f2-20261001-1235/review-20261001-1405/result.md)、[独立核验](evidence/G8-A/f2-20261001-1235/review-20261001-1405/independent-audit.json)；10项定向/全前端198、Rust138/0/3；fresh SHA2c6960df…06d53987，同PID100完整原节奏+20物理开合及正常退出/7进程回收。保留两工具失败；Show原同rect UNVERIFIED，新版性能未重测；后续普通dev由DEV1收口 |
| G8 | G8-A-DEV1 普通dev入口超时修复 | completed（开发入口/浏览器E1，不关闭G8-A） | [结果](evidence/G8-A/dev1-20261001-1650/result.md)、[独立核验](evidence/G8-A/dev1-20261001-1650/independent-audit.json)；只改Vite watch排除和新增真实watcher测试，默认两次入口及强制依赖冷优化补充PASS，浏览器40项/HMR、35 files/199 tests、typecheck/build与自有进程回收PASS；fresh dist与R1三文件SHA一致，未重建原生EXE、未重测性能；下一项Show尺寸/焦点语义 |
| G8 | G8-A-STATE1 P0窗口场景变化取证 | completed（仅来源归因；诊断原FAIL和旧P0未验保持） | 哥哥明确确认“有，我自己开了这三个icon”，旧19:27为用户主动配置，不修产品；[结果](evidence/G8-A/final-20261001-1814/state1-20261001-2036/result.md)、[确认原文](evidence/G8-A/final-20261001-1814/safe2-20261001-2108/user-confirmation.json)；不扩大到20:54输入来源、不重写12项11PASS/1FAIL或旧P0/P1；7进程/9243回收保持 |
| G8 | G8-A-SAFE2 场景恒定后的安全同版重测 | closed（五场景限定PASS＋用户辅助退出/实际回收PASS；自动suite原FAIL） | [场景父复核汇总](evidence/G8-A/final-20261001-1814/safe2-20261001-2108/safe-short-review.md)、[退出后独立读回](evidence/G8-A/final-20261001-1814/safe2-20261001-2108/user-tray-exit-retirement.json)；同SHA/PID各120/600，P1/P6各100完整循环，P2恢复/P3consumer已实测；原自动日志不改写 |
| G2 补充 | G2-UI-C 图标资源替换 | completed（C1/C2 E1；C3本卡E1/E2） | 最终前端182/182、Rust138/0/3、typecheck/build/fmt/release check PASS；C1/C2既有339项/55图，C3同SHA三组59项/26图、144 DPI四边0px、托盘显示/正常退出和7进程回收、22项独立核验PASS。高风险模块保持E1，发布/E5与普通dev根因未验证。见 [C3收口](evidence/G2-UI-C/c3-20260930/result.md)、[C2收口](evidence/G2-UI-C/c2-result.md) |

执行时展开当前Goal为每张卡一行，填状态/证据/阻塞。不能用“全部completed”掩盖未测子项。

G8-A已按用户确认的本轮范围收口；G2-UI-C来源/品牌、C1/C2 E1及C3 E1/E2保持。最终全场景性能/生命周期缺口保留在延期清单，安装包/随包许可与最终制品E5仍待G8-B/C；其他厂商/混合GPU支持未验证。本次仅同步文档，不重新启动程序或补测。

### G2-UI-C 当前执行卡（C1）

状态：completed（C1 E1，2026-09-29）。依据《图标资源与替换验收.md》§2–4；实施前 `icon/*.svg` 哈希与 E0 清单一致，`blocks.svg` SHA-256 为 `2bab1f7d783686678219b8f38667025d81a536430271214db73684647a53a2d8`。C1 共用摘要与设置阶段门已通过；C2 业务面板、C3 原生 ICO/Release 尚未开始。

允许：`icon/**` 只读；`app/src/shell/**`、`app/src/settings/**` 中图标相关组件/样式和对应测试；C1 浏览器 fixture 仅允许在 `app/tests/fixtures/ui-shell-preview.tsx` 将已退役的温度示例项替换为现有 ContentId 图标样例；必要的本地 SVG 资产仅在 `app/src/assets/**`；为修复 C1 浏览器 E1 入口，额外允许仅调整 `app/vite.config.ts` 的 `optimizeDeps.entries`，把依赖扫描限制到现有 `index.html` 与 `tests/fixtures/ui-shell.html`，避开 `src-tauri/target/**`、`evidence/**` 下生成的嵌入 HTML。禁止改业务存储/服务/监听、`research/**`、产品原型和 Tauri 原生资源；Codex/Clipboard/媒体/天气外部数据不触发。

本卡 C1 目标：建立可测试的共享本地图标映射与可随 CSS `currentColor` 着色的渲染；替换摘要栏图形状态、停靠拖动/设置入口、设置品牌/分类/模块注册图标；保留 Todo 数字读数、摘要无障碍名称、布局/点击区域、媒体/天气语义和设置文字按钮语义。天气未配置/未知代码维持原文字，不借图标臆造状态；`cloud-off` 仅在确认为 unavailable 时使用，stale 保留最后已知天气图。

验证结果：`npm.cmd test -- --run` 24 files/165 tests PASS；`npm.cmd run typecheck` 与 `npm.cmd run build` PASS；35/35 复制资产字节一致。隔离 Edge CDP 真实执行 72 项 E1 viewport/edge/icon/ring 矩阵，9 张截图与结果文件逐项一致；16px Blocks 实测、浅/深色 currentColor、8 个模块的尺寸、按钮无障碍名称、纯装饰图标和无旧字符 fallback 均 PASS，浏览器无 console/runtime 错误。Vite 预扫描阻塞已由限定 `optimizeDeps.entries` 修复；图标原先默认字形尺寸也经失败断言定位并改为槽位的 68%。详见 [C1 结果](evidence/G2-UI-C/c1-20260929/result.md)。本段仅收口 C1；C2/C3 尚未开始，真实 Tauri E2 和最终制品 E3 仍待后续阶段。

### G2-UI-C 当前执行卡（C2-Todo，2026-09-30）

状态：completed（本批 E1 PASS）。前置 C1 E1 PASS。本批仅替换待办面板的返回、拖动握把、完成/未完成、删除图形及拖动浮层中对应图形；任务文本、按钮名称、点击区域、排序与持久化行为保持不变。

实际修改：`app/src/features/todo/TodoPanel.tsx`；新增 `todo-panel-icons.test.ts`、隔离 E1 入口 `app/tests/fixtures/c2-todo-icons.html` 和 `c2-todo-icons.tsx`；证据与浏览器 runner 位于 `evidence/G2-UI-C/c2-todo-20260930/`。未改 CSS，仅复用 C1 `LocalIcon`；不改桥/Store/Rust/其他面板/原型/正式用户数据。fixture 以合成 Store 与内存命令验证图标、点击、键盘排序及拖动浮层，不启动真实服务；不能算 E2。

验证：先 SSR 失败断言再替换；浏览器复核 390/920 宽度与浅/深色、hover/键盘焦点、装饰性图标与可访问名称、点击和排序行为读回、拖动浮层、控制台错误；完整前端测试/typecheck/build 后回归 C1。停止条件：点击区域/业务行为改变、图标裁切或外部数据触发则停留本批诊断。原生 E2/E3 留待 C3/G8；本批通过后下一模块为 Timer。

实际结果：返回、行图标与拖动浮层分别取得 RED→GREEN；完整前端 25 files/167 tests PASS，含 typecheck 的生产构建 PASS。Todo 浏览器 E1 11/11 checks、5 图；C1 同源码回归 72/72、9 图；结果/截图计数独立核对通过，控制台异常 0，35 项本地 SVG 哈希一致。普通 `npm.cmd run dev` 本轮再次 HTTP 超时，根因未确认；使用仅本次的 noDiscovery/React 预打包、独立 scratch cache 与忽略生成目录的启动参数恢复验收链路，未写入正式配置，不能宣称普通 dev 入口 PASS。见 [C2-Todo 结果](evidence/G2-UI-C/c2-todo-20260930/result.md)。下一任务 C2-Timer；真实 Tauri/原生与发布关卡仍 UNVERIFIED。

### G2-UI-C 当前执行卡（C2-Timer，2026-09-30）

状态：completed（本批 E1 PASS）。前置 C1、C2-Todo E1 PASS。只将 Timer 共用 header 的“返回摘要”旧 × 替换为 arrow-left 16px；不为文字按钮增加图标，不改计时状态、读数、通知、Store/bridge、Rust 或用户数据。浏览器先发现 Timer 图标被共享 header span 规则染为 muted；进一步真实 Shell 集成检查确认 Todo 返回图标同类失败。将共享标题文字规则排除 .local-icon，统一修根因；撤掉 Timer 局部颜色补丁，不改原文字样式或按钮命中区域。

允许修改 `app/src/features/timer/TimerPanel.tsx`、`app/src/shell/shell-frame.css`（仅两个标题 span 选择器排除 .local-icon；共享影响以 Timer/Todo 集成检查、C1/Todo 回归证明），新增 `timer-panel-icons.test.ts`；`timer-panel.css` 恢复本批前原样。本批证据/runner 放 `evidence/G2-UI-C/c2-timer-20260930/`。复用已有 `app/tests/fixtures/ui-shell.html` 中 isFixture 的 TimerPanel 与 Shell 返回/Esc/焦点接线，不挂真实计时服务。证据明确为 E1，不替代运行/暂停/到期的原生行为验证。

验证：先 SSR 在正式/fixture 两个分支取得返回图标 RED，再只替换图形取得 GREEN，并断言正式分支原有文字操作/阶段/分钟输入未变。浏览器在 390/920 宽度与浅/深色检查 16px 本地 mask、currentColor、名称、装饰性与裁切/溢出，真实点击和键盘 Enter/Esc 返回、焦点恢复；完整测试/typecheck/build，独立保存 C1 与 Todo 回归。若语义/点击区域变动、私密数据/通知被触发或验收失败则停留本批。普通 dev 超时根因留在既有未验证边界，本轮仍使用隔离启动参数。完成后下一模块 Media，不自动开启真实媒体读取/控制。

实际结果：SSR 返回两个分支 RED→GREEN，3 项定向测试与全套 26 files/170 tests PASS；含 typecheck 的构建 PASS。Timer 20 项与共享 Todo header 1 项共 21/21、4 图；共享 CSS 最终修改后 C1 72/72、9 图及 Todo 11/11、5 图重跑 PASS。默认/hover/真实 Tab、Enter/Esc/鼠标返回与焦点恢复、原 40×40 按钮区域、16px 图标、浅/深色与窄屏通过；浏览器错误 0，35 SVG 哈希一致，18 PNG 核对有效，局部源码差异已逐块验证。浏览器输入脚本失败与产品颜色失败分开保存；普通 dev 根因未确认，原生计时/Tauri/托盘/发布仍 UNVERIFIED。详见 [C2-Timer 结果](evidence/G2-UI-C/c2-timer-20260930/result.md)。下一卡 C2-Media。

### G2-UI-C 当前执行卡（C2-Media，2026-09-30）

状态：completed（本批 E1 PASS）。前置 C1、C2-Todo、C2-Timer E1 PASS。本批只换媒体返回 arrow-left 16px、四个控制 skip-back/play/pause/skip-forward 20px、空态 music 28px 与缺封面 music 40px；保留原包装、按钮名称/title/点击区域、禁用/忙碌状态、会话选择、进度与失败反馈，不改业务逻辑。

允许 `app/src/features/media/MediaPanel.tsx`、仅确有图标布局需要的 `media-panel.css`、新测试 `media-panel-icons.test.ts`；新增隔离入口 `app/tests/fixtures/c2-media-icons.html`/`.tsx` 及 `evidence/G2-UI-C/c2-media-20260930/**`。fixture 挂真实 MediaPanel、MediaSnapshotStore 和合成 view，覆盖 bridge 的所有方法为内存/拒绝意外调用，不挂 Shell/Store.connect，不读真实媒体会话或发 native 控制，不访问网络封面/私人数据。样例是 E1，不冒充 provider 真实成功/失败 E2。

按返回、控制、占位图形逐个 RED→GREEN。浏览器检查 390/920×浅/深色的播放/暂停、限制能力、空态、加载、不可用和部分数据；图形来源/尺寸/着色/装饰性、原按钮点击区、无横向溢出；验证 hover、真实 Tab/Enter、内存 play/pause/previous/next 路由、切会话、pending 防重复、accepted/false/exception UI 读回，返回；完整 test/typecheck/build 后独立 C1、Todo、Timer 回归。源文件对照与结果/截图计数核验。若误触 native、图标裁切/行为变化则停留诊断，不借机修改服务。普通 dev 未确认根因沿用既有隔离启动参数。完成后下一卡 C2-Metrics，原生/制品关卡仍另验。

实际结果：返回、控制、占位三轮 SSR RED→GREEN；全套 27 files/173 tests、独立 typecheck、含 typecheck 的 build PASS。Media E1 39/39、7 图；同源码 C1 72/72、9 图，Todo 11/11、5 图，Timer/共享 header 21/21、4 图。默认/禁用/忙碌/hover/真实 Tab-Enter、合成控制 accepted/false/exception 反馈、会话选择目标、本地合成封面、返回均读回通过；错误及意外 native 方法调用 0。生产源码对照仅 10 个指定图形变更，Media CSS 字节不变；25 PNG、35 SVG 哈希和全部结果计数独立核验。未读取或控制真实媒体，未补成 G4-B3 native 故障分支通过；普通 dev 根因与原生/制品关卡仍 UNVERIFIED。隔离浏览器与 Vite 已回收，1430/9231 无监听。详见 [C2-Media](evidence/G2-UI-C/c2-media-20260930/result.md)。下一卡 C2-Metrics。

### G2-UI-C 当前执行卡（C2-Metrics，2026-09-30）

状态：completed（本批 E1 PASS）。前置 C1、C2-Todo/Timer/Media E1 PASS。已读取 MetricsPanel 与指标模型，实际图形入口只有共用返回按钮；CPU/GPU/内存名称、读数和 footer 状态点不是待替换图标，不额外添加装饰。只将旧 × 换为 arrow-left 16px，保留 ref/aria-label/onClose/40×40 区域及所有数据分支。

允许：`app/src/features/metrics/MetricsPanel.tsx`、新增 `metrics-panel-icons.test.ts`；新增隔离 `app/tests/fixtures/c2-metrics-icons.html`/`.tsx`、`evidence/G2-UI-C/c2-metrics-20260930/**`，及本文件/开发短计划/findings。禁止改 metrics bridge/store/model、Shell/CSS/Rust、原型、后台采样或正式用户数据。fixture 只传合成 MetricsViewState 到真实面板，不连接 Store/IPC；浏览器仅算 E1。

验证：返回图标 SSR RED→GREEN；CPU/RAM/GPU 成功、加载、不可用、CPU group-limit 与旧值失败说明/原时间；390/920×浅深色、默认/hover/真实 Tab-Enter、鼠标返回和尺寸/着色/裁切；完整 test/typecheck/build，独立 C1/Todo/Timer/Media 同源码回归。沿用隔离 Vite 参数，不把默认 dev 根因标已修。失败则停留诊断；通过后下一卡 C2-Codex，真实原生/制品关卡不在本批。

实际结果：SSR 1 failed/1 passed → 2/2 PASS，完整前端 28 files/175 tests、独立 typecheck、含 typecheck 的 build PASS。Metrics 75/75、6 图；Media 39/7、C1 72/9、Todo 11/5、Timer/共享 header 21/4 同源码重跑 PASS。五组共 218 项/31 PNG、35 SVG 与源字节一致、生产两处纯图形差异及 6 文件未变均独立核验。首轮 Edge 关闭 10 秒等待超时仅为测试宿主回收失败，保留日志后将正常等待增至 30 秒重跑全套通过；最终 1430/9231 无监听、task Edge/Vite 均 0。未调用真实硬件采样/IPC/外部业务服务，未修改模型、Store/bridge、CSS 或正式配置。普通 dev、native/托盘/制品边界仍 UNVERIFIED。见 [C2-Metrics 结果](evidence/G2-UI-C/c2-metrics-20260930/result.md)。下一卡 C2-Codex，不重读额度。

### G2-UI-C 当前执行卡（C2-Codex，2026-09-30）

状态：completed（本批 E1 PASS）。前置 C1 与 C2-Todo/Timer/Media/Metrics E1 PASS。本批只替换 CodexPanel 返回 × 为 arrow-left 16px；额度窗口、来源/观察时间、fresh/stale/unavailable、读取中与失败说明、原 ref/aria-label/onClose/40×40 区域保持。footer 状态点和数据文字不新增图形。

允许：`app/src/features/codex/CodexPanel.tsx`、新增 `codex-panel-icons.test.ts`；隔离 `app/tests/fixtures/c2-codex-icons.html`/`.tsx` 与 `evidence/G2-UI-C/c2-codex-20260930/**`；本文件、开发短计划/findings。不改 Codex model/store/bridge/CSS、Shell/Rust、配置、原型或正式数据。fixture 直接传合成状态到真实组件，不接 Store/IPC，不启动 app-server，不读 auth/额度；既有一次额度授权已耗尽。

定向回归发现既有 `CodexPanel.test.ts` 的三处“无虚构百分比”断言扫描完整 HTML，误把新 SVG data URL 的百分号编码当额度。仅允许这三处断言改为检查去标签后的实际文字；仍拒绝可见数字百分比，模型/产品数据逻辑不改，首次失败日志保留。

验证：SSR 图标 RED→GREEN、既有额度语义测试与前端全套/typecheck/build；390/920×浅深色覆盖 fresh、stale、unavailable、未连接、首次读取、刷新旧值与缺主/核心/窗口分支，图形来源/着色/裁切与真实 hover/Tab/Enter/鼠标返回；独立 C1/Todo/Timer/Media/Metrics 同源码回归，计数/截图/源码范围与回收校验。默认 dev 根因与真实 E2/E3 保留；本批通过后下一卡 C2-Weather，不因图标测试新增外部权限。

实际结果：图标 SSR RED 后两处最小生产替换；四处新旧“无百分比”测试因 SVG URL 编码误判，改为仅查实际文字后定向 7/7 PASS，失败日志保留。前端 29 files/176 tests、独立 typecheck、含 typecheck 的 build PASS。Codex 41/41、8 图；Metrics 75/6、Media 39/7、C1 72/9、Todo 11/5、Timer/共享 header 21/4 同源码 PASS，共 259 项/39 PNG、35 SVG、两处生产差异、旧测试三处指定变更及 9 项文件未变独立验证。无外部 HTTP 请求/浏览器错误；1430/9231 无监听、task Edge/Vite 均 0。未启动 app-server、读凭据/真实额度或改模型/bridge/store/CSS/正式配置。默认 dev、G5 在线失败及 native/托盘/制品边界仍 UNVERIFIED。见 [C2-Codex](evidence/G2-UI-C/c2-codex-20260930/result.md)。下一卡 C2-Weather，不发天气请求。

### G2-UI-C 当前执行卡（C2-Weather，2026-09-30 续行）

状态：completed（本批 E1 PASS）。哥哥要求一口气完成剩余 C2，仍按 Weather→Clipboard 顺序逐模块验证，不进入 C3。Weather 实际图形入口只有返回按钮；天气描述、当前/高低温、小时预报与 footer 状态点不是旧图标，不增加天气装饰图形。

允许：`app/src/features/weather/WeatherPanel.tsx`、新增 `weather-panel-icons.test.ts`、隔离 `app/tests/fixtures/c2-weather-icons.html`/`.tsx`、`evidence/G2-UI-C/c2-weather-20260930/**` 及本文件/开发短计划/findings。仅将 × 换为 arrow-left 16px；不改 CSS/model/store/bridge/Rust/配置/原型。fixture 直接传合成状态到真实组件，不联网、不定位、不挂 Store/IPC。

验收：返回 SSR RED→GREEN；390/920×浅深色覆盖未配置、读取中、fresh、stale、unavailable、未知天气代码、摄氏/华氏与小时预报，保留原来源/观察时间；16px 本地 mask/currentColor/装饰性与原40×40区域、无裁切/溢出、hover/真实Tab-Enter/鼠标返回；完整 test/typecheck/build 与 C1/既有 C2 同源码回归，独立核验结果/截图/源字节与进程回收。沿用隔离 Vite 参数，普通 dev 根因与 E2/E3 保留未验证。阶段门通过后直接继续 Clipboard；任何真实业务数据触发或行为改变停留诊断。

实际结果：返回箭头 SSR 预期 RED→GREEN，定向4/4、全前端30 files/177 tests、typecheck/build PASS。Weather 37/8图、Codex 41/8、Metrics 75/6、Media 39/7、C1 72/9、Todo 11/5、Timer/共享header 21/4同源码通过，296项/47PNG、35SVG、两处生产差异及36旁支文件未变独立核验。浅深色截图已目视复核；浏览器错误/外部请求0，端口与task Edge/Vite回收PASS。没有联网/定位/IPC，普通dev与原生/制品边界保持。见 [C2-Weather](evidence/G2-UI-C/c2-weather-20260930/result.md)。直接进入 Clipboard。

### G2-UI-C 当前执行卡（C2-Clipboard，2026-09-30 续行）

状态：completed（本批E1 PASS，C2七面板全部完成）。前置Weather E1已通过。本批实际图形只有返回按钮；“复制”“删除”“清空全部”“上一页”“下一页”和条数是准确文字，保持不变。不新增Pin图标或按钮。

允许：`app/src/features/clipboard/ClipboardPanel.tsx`、新增 `clipboard-panel-icons.test.ts`、隔离 `app/tests/fixtures/c2-clipboard-icons.html`/`.tsx`、`evidence/G2-UI-C/c2-clipboard-20260930/**` 及规划/发现文档。只替换返回 × 为 arrow-left 16px，不改 CSS/store/bridge/model/Rust/Shell/配置/原型。fixture 使用真实面板和 Store，所有 bridge 方法均为任务内合成内存实现；setEnabled 拒绝意外调用，绝不连接 native 或 navigator.clipboard，不监听、不读写私人 Clipboard。

验收：返回 SSR RED→GREEN；390/920×浅深色覆盖空态、未读取、历史、长文本/转义、失败与监听不可用、分页/忙碌；本地mask/16px/currentColor/装饰性、原40×40按钮区域、文字按钮名称/禁用/点击行为读回、两行预览与单滚动区；真实hover/Tab/Enter/鼠标返回。完整 test/typecheck/build，C1及全部C2同源码回归、独立计数/PNG/SVG/源差异/清理核验后收口C2。遇真实Clipboard调用、越权、交互改变或验证失败停留诊断，不改业务逻辑；C3不启动。

实际结果：Clipboard箭头SSR预期RED→GREEN，最终31 files/178 tests、typecheck/build PASS。Clipboard43/8图、Weather37/8、Codex41/8、Metrics75/6、Media39/7、C1 72/9、Todo11/5、Timer/共享header21/4同源码重跑PASS，339项/55PNG独立核验。生产Weather/Clipboard各两处图形差异，119旁支文件（含43源SVG）未变、35复制SVG字节一致，浅深色/长文本截图已目视检查。Clipboard的copy/delete/clear/失败/忙碌/分页与面板轮询回收仅由合成内存bridge验证，不触发系统API；浏览器错误/外部请求/意外监听调用0，端口/task Edge/Vite回收PASS。独立核验首次误把禁用API注释当调用，保留失败日志后仅修扫描范围再通过；无产品绕过。C2已收口，见 [最终批](evidence/G2-UI-C/c2-clipboard-20260930/result.md)、[C2汇总](evidence/G2-UI-C/c2-result.md)。下一卡C3，本轮不启动，普通dev与所有原生/制品边界保持。

### G2-UI-C 当前执行卡（C3，2026-09-30）

状态：completed（本卡E1/E2，2026-09-30）。哥哥明确授权继续C3及设置输入F1；C1/C2 E1前置已通过。只读`icon/blocks.svg`生成原生应用/托盘图标，沿用既有品牌底色与透明圆角、不改变Blocks几何。真实桌面仅唯一Bundle ID的隔离Release，安全配置Todo/Focus/CPU/GPU/内存；未触发Codex读取、天气网络、媒体订阅/控制或Clipboard listener。

具体变更文件：`app/assets/widget-platform-icon.svg`、`app/src-tauri/icons/{icon.ico,icon.png,icon.icns}`，必要的图标配置/托盘接线需先确认实际缺口再改；本轮 runner/隔离配置/截图/原始日志均在 `evidence/G2-UI-C/c3-20260930/**`，并更新本文件、开发短计划与 findings。未提交工作树先保存 325 文件哈希基线；不覆盖用户应用或历史证据，不改业务实现、CSP、原型及源 SVG。

验证顺序：图标源哈希/几何、ICO 层级与小尺寸浅深底预览 → 前端全套/typecheck/build 与 Rust 检查 → 无 probe feature、独立 Bundle ID 的同版 Release → 实际摘要/设置/Todo/Focus/指标面板、返回/Esc、四边拖动及窄窗 → 精确托盘图标/显示/正常退出/自有进程回收。高风险模块各状态沿用 C1/C2 E1，不伪称 native E2。任一身份/前台守卫失败或真实小图不可辨，停留本卡诊断。安装包/随包许可及最终性能 E3/E5 留给 G8，不以 C3 冒充发布或用户确认。

C3-F1 最小范围扩展（哥哥已明确批准，2026-09-30）：真实 Release 空白异常栈定位到 SettingsPanel 城市输入 deferred updater 读取已释放的 event.currentTarget；四处合成生命周期测试复现同一 TypeError（4/4 RED）。本卡追加允许 `app/src/settings/SettingsPanel.tsx` 的 name/latitude/longitude/timezone 四处 onChange，以及 `app/src/settings/settings-weather-draft.test.ts`；仅立即捕获 value 后更新草稿，禁止改 schema、保存/天气请求/服务/权限/布局。修复后补定向、全前端回归与 fresh Release，同新 SHA 重新验证输入不空白、不点击保存天气配置、不发天气网络。旧 SHA 和失败轮保留，不能把旧版本 E2 回填新版本。

实际收口：四处RED→GREEN；前端32 files/182 tests、Rust138/0/3、typecheck/build/fmt/release check与feature-free no-bundle fresh构建PASS。隔离Bundle `com.widgetplatform.g2uic.c3.f1.20260930`，SHA `56bc5644e88382e59e57c6add8f99b9899acb66fa1619e23f60df3875ebc476f`。同SHA真实嵌入WebView三组59项/26图，含浅深摘要/设置/五安全模块面板、返回/Esc、四输入不空白且weather配置字节不变、144 DPI四边真实鼠标拖动与0px贴边。托盘菜单本轮UIA暴露无子项Pane，诊断截图确认菜单后按精确PID/SHA/HWND/前台/命中守卫真实鼠标显示和正常退出；600ms暂时扩窗的原失败保留，后续稳定外框与隐藏前完全一致。应用及6个自有WebView全部回收、9232关闭；22项独立审查PASS，325原基线仅四资产+SettingsPanel变化、四处修复逆向字节证明、F1后221源码未变、35复制SVG与43源素材保持。高风险模块原状态仍是E1；左侧悬停扩窗不冒称390px摘要，单屏144 DPI不覆盖多屏/混合DPI。原普通dev、G5/G6和最终E3/E5边界不变；下一卡继续G8-A，G8-B/C未启动。见 [C3结果](evidence/G2-UI-C/c3-20260930/result.md)、[独立审查](evidence/G2-UI-C/c3-20260930/f1-verify/final-independent-audit.json)。

### G8-A 当前续行子卡（G8-A1，2026-10-01）

状态：completed（本卡限定E1/E2/P0/P1局部E3，G8-A总体仍in_progress）。哥哥指示开始执行G8，C3/F1前置已解除。本批合同见 [首轮合同](evidence/G8-A/run-20261001-0810/plan.md)、[同版续测合同](evidence/G8-A/run-20261001-0810/resume-20261001-1138/plan.md)，结果见 [短测收口](evidence/G8-A/run-20261001-0810/resume-20261001-1138/result.md)。测量判定RED→GREEN、fresh唯一Bundle Release、安全切换/P0/P1完整实测与回收已完成；追加产品范围仅下列F1/SEC。未授权额度重读、Clipboard采集/写回、当前媒体控制、用户天气坐标、全局断网或自动系统睡眠/重启；P2–P7/24h与最终组合未通过或哥哥未明确批准限定范围前，不进入G8-B/C。

本轮授权澄清（2026-10-01）：哥哥明确选择“暂不启动24小时长测，G8-A保留未完成”；媒体/天气真实性能授权问题被跳过，未取得新增授权，不读取当前会话或发天气请求。继续本批不依赖这些授权的短测/安全生命周期；不启动24h、不自动睡眠/重启，不把跳过解释为同意，也不自动进入G8-B/C。

G8-A1-F1最小缺陷修复范围：P1真实输入已读回，关闭/重开后实际input.value为空（旧SHA `177266d6…6138b1`）；`TodoPanel`的draft为局部useState，Shell条件卸载面板导致丢失，违反PRD§2/§5。本卡追加 `app/src/features/todo/TodoPanel.tsx`（受控草稿）、`app/src/shell/ShellFrame.tsx`（同应用会话持有草稿）、新增 `todo-panel-draft.test.ts`、旧图标测试和 `app/tests/fixtures/c2-todo-icons.tsx`（仅必需props接线）。不改存储/IPC/样式/布局，不把草稿持久化到磁盘。先E1失败断言再修，重建新SHA、重跑最终同版P0/P1和100次重开，不用旧SHA的P0冒充新制品。旧P1第一轮失败/中断保留；不把中断测量计作完整P1。

G8-A1-SEC最小范围补充：任务隔离profile中由Windows/WebView生成了身份缓存目录（只发现目录/文件名，未读取内容），现有.gitignore未忽略profile。允许仅追加 `.gitignore` 的 `evidence/**/profile/` 规则，并用git check-ignore验证本轮/旧任务profile缓存被排除、原始result/CSV/日志仍可见。不读缓存、不删除profile、不把它打包或提交；后续查询仅针对精确任务Bundle数据目录。

实际收口（2026-10-01）：草稿4项及pending期间新编辑1项RED→GREEN；同会话持有，不新增磁盘存储。33 files/187 tests与Rust138/0/3、typecheck/build/fmt/locked release check PASS；fresh无feature隔离SHA `55ba185d4850a4b3d81c70a28587540cf0c0e4544b086ab6f399ddcf3bcb8c85`。续行时原PID29904已不存在、原因未明，旧证据保留；新profile/PID24988重测同启动P0/P1，各120秒热身+600秒、121样本/120 CPU差分，包含根+6 WebView。P0平均CPU0.000912%、Private WS123.454771MiB、Private Bytes229.212745MiB，原预算PASS；P1活动平均CPU0.346106%、WS136.392982MiB、Private Bytes247.419002MiB，不套P0预算。11项草稿smoke、100次Todo重开、稳定后安全五模块各20次面板与100次设置、同PID托盘Show/正常Exit及7进程/9233回收PASS。

安全切换首轮34次后未打开面板；被动事件第42轮诊断记录pointerdown命中memory时viewport宽440、pointerup时已宽320且命中非按钮。仅修本轮runner的有界几何稳定等待/命中守卫，再从0完整重跑100+100通过；旧失败保持UNVERIFIED，不宣称产品快速物理点击已修。5个资源观察点根线程26/句柄334、7进程保持，group Private Bytes首尾增长13.609375MiB、相对峰值15.7734375MiB，不外推24h。独立审查PASS：326原基线4授权差异/322未变+1新测试，续行327文件不变，两场景CSV、28检查/300循环、8PNG与精确回收均核对。高风险访问、全模块enable/disable、原生token/worker计数、P2–P7/24h/恢复、无debug参数制品、GPU/wakeups/树外WebView和E5保持UNVERIFIED。下一卡G8-A2先建立安全P2/P3/模块启停合同；不启动G8-B/C。

G8-A2合同已建立（2026-10-01）：合同阶段只写 `evidence/G8-A/run-20261001-0810/g8-a2/**` 与进度文档，不改产品源码。P2固定为隔离 Release 中 `enabledContentIds=[focus]`、摘要 `hidden`、真实 Timer running；P3固定为仅 `cpu/memory`、摘要 always、设置/活动面板关闭、document 可见、无外部 provider。合同明确 enabled、visible consumer、活动面板、Settings 覆盖、Timer 后台和退出回收不是同一状态；特别保留“运行中禁用 Focus 必须明确取消或阻止保存”的安全门。按哥哥最新优先级，G8-A2暂缓，待F2及普通dev入口问题分别收口后再启动；不启动24h和G8-B/C。

### G8-A1-F2 当前执行卡（2026-10-01）

状态：completed（本卡限定E1/E2，不关闭G8-A）。F2合同见 [合同](evidence/G8-A/f2-20261001-1235/plan.md)，结果见 [F2结果](evidence/G8-A/f2-20261001-1235/fixed/result.md)。复现根因是 hover 概况驱动原生扩窗/收窗与指针 press 生命周期交叉；先以 `shell-view.test.ts` 得到 7/8 RED，再在 `ShellFrame.tsx` 按下期间冻结 hover 清理、释放后恢复，8/8 GREEN。全前端33 files/188 tests、typecheck/build通过，fresh Release SHA `70972fbe67a12622e13aee807ea4af5b478f72d4494fb0415e265491d2a2e720`。

新隔离 Release 未加稳定等待，真实 Win32 mouse_event 对内存模块100次点击均读回内存活动面板；第1–68与第69–100分段证据合计100/100，runtime errors 0。第68轮runner因时间上限中止后独立 Escape 读回通过；正常托盘退出通过桌面精确菜单“退出 Widget Platform”，自有PID/精确EXE/9235端口回收为0；独立 source-baseline 审查只见三个允许 shell 文件变化。F2不处理普通dev入口超时；P2/P3合同保持暂停。

### G8-A 当前执行卡（2026-09-29 启动，历史入口）

哥哥明确要求开始 G8。本轮先执行 G8-A 的非侵入入口预检：核实当前代码/构建、已有测量脚本与 P0–P7/24 小时合同的差距，保存真实测试证据。允许变更 `evidence/G8-A/**`、本文件、`findings.md`；只有发现可复现缺陷后才在 G8-A 允许的测量脚本或范围内 bug 文件做最小修复。禁止读取真实额度/私人剪贴板、启用未知后台监听、改用户正式数据、覆盖正在运行的产品 EXE，或把旧图标版测试冒充最终性能 E3。

入口风险：新要求 G2-UI-C 目前只有来源/品牌 E0，图标接线与原生资源未做；完整 P0–P7、100 次开关与 24 小时应对**最终启用功能和最终同版 Release**实施，不能用当前旧图标工作树收口。`measure-processes.ps1` 目前只声明 P0/P1，不能凭脚本存在宣称覆盖 P2–P7。G5 仅按已批准 partial 边界交付，Agent 产品桥/UI 不在当前可用组合；Clipboard 默认关闭，真实采集和写回不因性能测试自动获授权。G8-B/C 仍不得开始；预检结果决定当前卡下一段与所需前置。

预检发现必须先修的隐私违约：前后端新安装默认 `enabledContentIds` 均包含 `clipboard`，而 Shell 对可见模块直接调用 listener enable；这与 PRD 的默认不采集和 G6-B 合同矛盾。G8-A 本轮允许新增最小修复文件清单：`app/src/settings/settings-model.ts` 及其测试、`app/src-tauri/src/host/settings.rs` 的默认值与相邻测试；仅变更**无设置文件时**的默认组合，保留旧用户明确保存的 enabled 顺序及历史，不改 listener/存储语义。先写失败测试，再修复并跑完整回归。修复后仍不能把无隔离的旧 Release 用于性能测量。

阶段结果：已按 RED→GREEN 修复前后端无设置文件时 Clipboard 默认启用的违约；哥哥随后明确决定：**旧版设置首次升级统一关闭 Clipboard 监听，保留历史；想继续记录需手动重新显示模块**。据此在本卡扩展同一设置领域的迁移修复：`app/src/settings/settings-model.ts`/测试、`app/src-tauri/src/host/settings.rs`/测试，以及 `产品需求文档.md`、`架构说明.md`、`测试与验收标准.md` 对应隐私/迁移合同、`README.md` 的 G8 进度导航、`evidence/G8-A/**`、本文件和 `findings.md`。设置 schema v5 在内存迁移旧文件、移除旧 Clipboard 启用，原设置文件和历史库不由迁移写删；v5 手动重新显示后保留。最终前端 160/160、Rust 138/0/3、typecheck/build/fmt/Release check PASS；隔离 Release 新安装真实窗口未见 Clipboard 入口，但 listener 原生注册与旧设置真实升级、托盘退出仍 UNVERIFIED。G2-UI-C 仍是最终同版制品前置；G8-A 不宣称完成，G8-B/C 仍未开始。结果与两轮托盘探针阻塞见 [G8-A 结果](evidence/G8-A/result.md)。

### G5-A 当前执行卡

状态：completed（E1）。允许修改 `app/src/features/codex/**`、`app/tests/fixtures/codex/**`、`app/src/settings/settings-model.ts` 与其测试、`app/src/shell/ShellFrame.tsx`、`app/src-tauri/src/host/settings.rs`（仅 ContentId 与 v3 设置迁移）、`evidence/G5-A/**`、本文件、`开发短计划.md`、`findings.md`。迁移保留用户既有模块顺序和选择，仅对旧 schema 追加新模块；schema v3 中用户显式关闭 Codex 时不重新启用。

明确不在本卡范围：额度 transport、启动真实 Codex app-server、读取/显示凭据、访问 auth.json、发起网络请求、Hermes hook 或 Agent 状态桥。G5-B 需单独满足官方接口复核和真实只读测试授权。

本轮实际结果：parser、Codex 只读面板、前端 ContentId/schema v3 迁移及 Rust host/settings v3 迁移均已实现。`npm test -- --run` 为 92/92 PASS；`npm run build`（含 typecheck）PASS；项目 wrapper 下 Rust 全量 52/0/1、`cargo fmt --check` 与 `cargo check --locked` PASS。初次裸跑 Cargo 的 exit 127 是遗漏项目 helper，已纠正；详见 [工具链检查](evidence/G5-A/toolchain-check.md) 与 [尝试记录](evidence/G5-A/attempts.md)。没有做 Tauri E2 或真实 Codex 读取。证据见 [G5-A 结果](evidence/G5-A/result.md)。

### G5-B 当前执行卡

状态：completed（E1/E4）。允许路径已完成；不得读凭据文件。所有 child process 由调用方拥有，超时/取消/输出上限后必须 kill+wait。哥哥明确授权后，专用 Rust live test 只做一次 gateway 状态检查和一次 quota read，E4 通过；授权已用完，不再重试。

本轮实际：实现 Rust JSON-RPC transport、single-flight runtime、取消与清理、错误退避及 Tauri command 注册。合成子进程覆盖握手/顺序、gateway 未就绪、RPC/429 脱敏、登录请求拒绝、超时、单行与总输出限额、取消及 child wait/reap。`cargo test --locked` 66 passed/0 failed/2 ignored，`cargo fmt --check`、debug/release `cargo check --locked` 均 PASS；哥哥新授权的一次产品 Rust live test 1/1 PASS。只记录测试结果，没有保存/输出原始响应、额度数值或凭据。前端 command 接线和 Tauri 窗口验收不在本卡允许范围，另排。

收口：哥哥于 2026-09-28 明确要求 G5 以限制已记录的部分完成收口，接受 G5-B-UI 在线失败降级 E2/E4 保持 UNVERIFIED，并接受 G5-C 产品桥/UI 不纳入本轮；不宣称整体 E2/E4 全项通过。额度授权已耗尽，不再读取。未来若要补测在线失败降级，需另行取得明确授权。

### G5-B-UI 当前执行卡

状态：partial / 整体 E2/E4 UNVERIFIED（前端 E1 PASS；隔离 Release 真实成功读取路径已观察；2026-09-28 正常托盘退出 E2 PASS。在线失败降级仍无 Release 证据；已有 E1 错误/last-good 测试覆盖）。额度读取授权已消耗，不重读；应用已通过精确托盘“退出 Widget Platform”菜单正常退出，未强制结束、未点开面板、未读取额度。前置 G5-A 与 G5-B Rust command E1/E4 已完成；沿用批准的 UI-D1 v2，不重新设计 Codex 面板。

允许修改：`app/src/features/codex/CodexPanel.tsx`、`CodexPanel.test.ts`、`codex-quota-model.ts`、`codex-quota-model.test.ts`；计划新增 `codex-bridge.ts`、`codex-bridge.test.ts`、`codex-quota-store.ts`、`codex-quota-store.test.ts`；`app/src/shell/ShellFrame.tsx`；`evidence/G5-B-UI/**`、本文件、`开发短计划.md`、`findings.md`。不改 Rust command/backend、布局 CSS、其它模块或用户 Hermes 配置；不输出额度值、完整响应、凭据或 auth 文件。

行为合同：仅在真实模式打开 Codex 面板时通过 `codex_quota_read` 读取；测试 fixture 不发 IPC。响应必须使用后端给出的 `observedAtMs`，保留来源、fresh/stale/unavailable 与错误分类；失败保留 last-good 及原观察时间。关闭面板时停止前端调度并取消正在运行的自有读取；单活跃请求，刷新不快于后端 5 分钟约束，尊重 `retryAfterMs`/退避，不因 `refreshNotDue` 伪造新鲜数据。

本轮实际：bridge/store 已接通，仅在真实、可见 Codex 面板读取；last-good、后端时间戳、退避、取消与 StrictMode 重连路径均有测试。完整前端测试 16 files/118 passed，`npm run typecheck`、`npm run build` PASS。使用隔离 Bundle ID `com.widgetplatform.g5bui.quotae2` 和 task-local Cargo target 构建 Release。哥哥新增授权后，以进程级隔离环境打开一次 Codex 面板，观察到 fresh 状态、核心窗口行、来源和更新时间；额度值与响应未记录。之后对精确 Release PID 执行正常托盘退出 E2 验证并确认进程退出；探针未点击 Codex 面板、未触发额度读取。证据见 [结果](evidence/G5-B-UI/result.md)、`evidence/G5-B-UI/live-e2e-result-20260928.json`、`evidence/G5-B-UI/authorized-live-read-20260928.md` 与 `evidence/G5-B-UI/tray-exit-20260928.json`。

验证：mock bridge/store 单测与现有 CODEX-01 parser/panel 测试、`npm test -- --run`、`npm run typecheck`、`npm run build` 均 PASS。隔离 Release 真实面板成功读取的数据状态/来源/时间已观察；正常托盘退出 E2 PASS。在线故障降级没有 Release 真实证据，因此整体 E2/E4 暂不标 PASS；现有 E1 测试覆盖错误与 last-good。额度读取授权已耗尽，不重启应用、不再次打开面板、不重读额度。任何需要再次触发真实 quota command 的验收均须先取得哥哥新的明确授权。

### G5-C 当前执行卡

状态：partial（纯 reducer E1 PASS；单 turn Hook 源事件形状 E4 PASS；产品运行时桥/UI UNVERIFIED）。范围确认（2026-09-28）：哥哥明确接受 G5-C 本轮保持 partial，产品运行时桥/UI 不纳入本轮 G5 收口；不要将此决定追溯归因于 2026-09-27 的具体原话（该原句未核实）。当前实现契约为保留 `sessionId` 身份，普通成功 turn 仅映射为 Waiting、不映射为 Done。允许修改 `app/src-tauri/src/features/agent/**`、`app/src-tauri/src/features/mod.rs`（仅注册纯模型模块）、`evidence/G5-C/**`、本文件、`findings.md`、`开发短计划.md`。本次一次性 Hook 配置/事件授权已使用并回滚；后续任何配置或真实 Hook 运行都需新授权。禁止输出 prompt/response/tool arguments。

能力核验：本机 Hermes CLI 为 `v0.21.5+3397.gd25bbd0`（2026.9.24）；当前会话 provider 为 `openai-codex`。`agent/turn_finalizer.py` 在每次 `run_conversation` turn 后发出 `on_session_end`；`completed` 由本轮 `final_response`、`failed`、`interrupted` 和迭代预算决定，不是整体任务成功信号。subagent start/stop 有 `child_session_id`，但 child `status=completed` 也可能来自 `max_iterations` 且生命周期 hook 未传 `exit_reason/truncated`，因此不能据此报告可靠 `Done`。Hermes Kanban 的 `kanban_task_completed` 是明确任务完成事件，但以 `task_id/run_id` 标识，不符合当前 Agent `sessionId` 契约。

本轮实际：实现 `AgentSessionReducer` 与序列化快照；只接收规范化的 turn-start/turn-end 事件，不包含 prompt/response。成功 turn→Waiting，明确失败→Failed，明确中断→Cancelled，模糊终态/过期→Unknown；保留 Done 枚举但当前 session 来源不会生成 Done。定向测试 11/11 PASS；全 Rust 77 passed/0 failed/2 ignored；fmt、debug/release check PASS。最近 64 个已完成 turn ID 用于丢弃迟到的重复 start/end。离线 Hook payload 白名单探针 synthetic tests 8/8 PASS；一次真实 Hermes CLI turn 实际触发 `pre_api_request` 与 `on_session_end`，capture 只记录脱敏字段，结果见 `evidence/G5-C/hook-live-result.md`。产品运行时桥与 UI 仍未实现。

Hook 探针期间仅对目标两键临时写入并精确 readback，真实 turn 完成后以 `config unset` 移除并再次验证为空；`hermes hooks revoke` 报告移除 2 条许可，Hermes venv 的精确 pair 查询确认均不存在。`hooks` map 的只读摘要仅显示事件名/条数；其他配置未读，allowlist 未做广泛枚举。初次用系统 Python 复核许可因缺 `ruamel` 失败，改用 Hermes venv 后通过。

下一步：依哥哥于 2026-09-28 的明确范围确认，G5-C 保持 partial，Agent 产品桥/UI 不纳入本轮 G5 收口；不重新运行 Hook。真实观察证明 `pre_api_request` 原始 payload 风险包含 user message/history/system prompt；helper 只在内存处理白名单字段，capture 只写事件名、字段存在性、provider、状态标志和观察时间。approval `session_key` 与 `sessionId` 尚未证明可关联，暂不映射。当前两个 Hook key 与精确命令许可均已移除。

### G6-A 当前执行卡

状态：completed。哥哥于 2026-09-28 明确要求执行 G6；本卡已完成，结果见 `evidence/G6-A/result.md`。

允许修改：`app/src/features/weather/**`、`app/tests/fixtures/weather/**`、`app/src/settings/**`（仅 Weather 配置、ContentId 与 schema v4 迁移）、`app/src/shell/ShellFrame.tsx` 与 Weather 所需样式、`app/src-tauri/src/features/weather/**`、`app/src-tauri/src/features/mod.rs`、`app/src-tauri/src/lib.rs`、`app/src-tauri/src/host/settings.rs`、`app/src-tauri/Cargo.toml`、`app/src-tauri/Cargo.lock`、`evidence/G6-A/**`、本文件、`开发短计划.md`、`findings.md`。不改其它业务模块，不建立 provider 抽象，不自动定位，不读取系统位置。

合同：用户显式配置城市名、WGS84 纬经度、IANA 时区与摄氏/华氏单位；未配置时不发网络请求。单次请求同时取得 current、daily、hourly；成功缓存 30 分钟，失败指数退避并保留 last-good 的来源与原更新时间。模块可见才是消费者，设置打开、模块隐藏或应用退出时停止前端调度并取消自有请求。来源固定显示 Open-Meteo 及数据更新时间；免费端点仅用于当前非商业自用，发布/商业化前重新核对条款与端点。

验证：先用合成 fixtures 做 WEATHER-01 E1，包括城市/时区/单位、旧缓存、限流/失败退避、无配置不请求、重复连接不产生重复请求；再将一次固定公共坐标的真实查询作为独立 E4 证据，不把它当用户位置。完成条件：E1 全量通过；断网/失败仍显示 last-good 来源与原更新时间；请求间隔不短于 30 分钟；真实 E4 若因网络环境失败则明确 UNVERIFIED，不伪造通过。

本轮实际：Weather 前后端、设置 schema v4、30 分钟缓存、位置隔离退避、作用域取消、逐 chunk 响应限额和有界磁盘缓存均已实现。两轮独立审查发现的跨位置 cooldown、取消退避/竞态、伪 IANA 时区、未来缓存、页脚时间语义与内存边界均按 TDD 修复。最终前端 19 files/140 tests，Rust 92 passed/0 failed/3 ignored，fmt、typecheck、build、debug/release check 全部 PASS；一次固定 Berlin 公共坐标真实查询 1/1 PASS。未读取系统位置、用户位置、凭据或完整响应。

### G6-B 当前执行卡

状态：completed。前置 G6-A 已完成；本卡只执行文本剪贴板合同与安全测试，没有注册系统监听、调用剪贴板 API、读取或覆盖用户当前剪贴板。

允许修改：Clipboard 合同模型与合成 fixtures/tests、`架构说明.md` 与 `测试与验收标准.md` 中 CLIP-01 的精确边界、`evidence/G6-B/**`、本文件、`开发短计划.md`、`findings.md`。不接入 `AddClipboardFormatListener`，不创建真实数据库，不启动真实采集。

工作默认：纯文本；保留 7 天、最多 200 条、总明文 10 MiB；Pin 免于按时间/条数普通淘汰，但仍受总字节硬上限，超过硬上限时拒绝新 Pin/写入而不静默删除 Pin。来源只保留可选、最小化应用标识，不保存窗口标题或进程路径。DPAPI 采用 CurrentUser 作用域；恢复只写回系统剪贴板，不自动粘贴；自有恢复标记/sequence 防止回写形成新历史。默认关闭。

完成条件：合成测试覆盖默认关闭、纯文本标准化、敏感/自有标记排除、相邻去重、保留期限、条数/总字节、Pin 硬边界、分页/删除/清空范围、恢复标记和 DPAPI 错误语义；SEC-01 说明不记录正文/密钥/私人 clipboard。完成本卡仍不得启动真实采集，G6-C 需另行真实授权。

本轮审查修复：首次独立审查发现保留期只在下次捕获触发、Pin 不检查总字节硬上限两个阻断，以及时钟回拨、Duplicate 淘汰回报、restore marker 唯一性和空解保护等边界缺口；第二次审查继续发现 excluded capture、过期项 Unpin、回拨高水位和 marker 队列溢出问题。已按 TDD 改为所有有效捕获及浏览/分页/恢复/Pin 变更前清理，过期 Pin 在 Unpin 时立即删除，时钟回拨一次性清理后重建基线，所有捕获结果回报已提交淘汰 ID，marker 使用实例标识与单调序号且队列满时拒绝新恢复，不丢弃旧 marker；空解保护结果视为无效载荷。最终定向 16/16、全 Rust 108/0/3、fmt/release/diff check PASS；第三轮独立审查无阻断、中等级或低等级新增缺陷，结果见 [G6-B 结果](evidence/G6-B/result.md)。

### G6-C 当前执行卡

状态：in_progress，因预计跨后端、前端与真实 E2，顺序拆为连续子任务；一次只执行当前子任务。

| 子任务 | 状态 | 允许范围 | 验证与停止条件 |
|---|---|---|---|
| G6-C1 安全存储、DPAPI 与监听后端 | completed（E1；真实写回边界保留） | `app/src-tauri/src/features/clipboard/**`、`features/mod.rs`、`lib.rs`（仅 Clipboard state/commands）、`Cargo.toml/Cargo.lock`、合成 tests、`evidence/G6-C1/**`、规划/发现文档 | TDD 建立 versioned ciphertext 存储、事务迁移、可注入 listener/clipboard adapter、有限重试、enable/disable/stop 资源释放和 commands；尊重 Windows 隐私排除格式；Rust 132/0/3、fmt、release check 通过。真实 listener 启用/关闭由 C3 验证；真实写回、重启持久化和正常托盘退出未单独验证 |
| G6-C2 前端设置、历史界面与 Shell 生命周期 | completed（E1 + 用户 E5） | `app/src/features/clipboard/**`、`app/src/settings/settings-model.ts`、`app/src/shell/ShellFrame.tsx`、`evidence/G6-C2/**` | Clipboard 模块显示即监听；面板关闭/窗口隐藏/设置页打开不停止监听；实时刷新、复制/删除、单滚动条、历史数量横向控件、两行预览已验证。前端 154/154、typecheck/build PASS。 |
| G6-C3 隔离 Release 与真实 E2 | completed（按本轮产品范围；保留未验证边界） | 任务专用 profile/runner、`evidence/G6-C3/**`、必要的任务内修复 | 独立 Bundle/用户目录 Release 已验证 listener 启用/关闭；正式运行实例验证模块显示即监听、面板关闭后继续记录和最终 UI。强制终止后的精确残留扫描通过；正常托盘退出、真实写回当前剪贴板和重启持久化未单独验证，不阻塞本轮收口。 |

G6-C1 当前证据：SQLite versioned ciphertext、DPAPI CurrentUser、可注入运行时、Windows 隐藏消息窗口与有限重试、IPC 命令接线及 Windows 隐私排除格式已实现；Rust 全量 132 passed/0 failed/3 ignored，fmt 与 release check PASS。独立审查子任务中断未形成结论，已由父会话完成定向只读核对并修复写回部分成功与隐私排除缺口。C1 E1 completed；真实 listener 启用/关闭/退出释放见 C3，捕获/恢复写回仍 UNVERIFIED。见 `evidence/G6-C1/result.md`。

G6-C2 当前证据：Clipboard 前端模型/store/bridge/panel 已实现并接入 Shell；Clipboard 模块显示即监听，面板关闭/窗口隐藏/设置页打开不停止监听；实时刷新、复制/删除、单滚动条、历史数量横向控件和两行预览已通过真实窗口复核。前端全量 23 files/154 passed，typecheck/build PASS。真实写回当前剪贴板、重启持久化和正常托盘退出作为本轮明确边界保留。见 `evidence/G6-C2/result.md`。

G6-C3 当前证据：独立 Bundle ID `com.widgetplatform.g6c3.clipboarde2` 和 task-local Release 真实启动，预置仅 Clipboard 模块；隔离 listener 启用/关闭和精确残留扫描通过。正式运行实例进一步验证 Clipboard 模块显示即监听、关闭活动面板后复制仍继续记录、实时历史和最终 UI。未向系统 Clipboard 写入合成文本；真实写回、重启持久化和正常托盘退出未单独验证，作为不阻塞本轮产品收口的边界。详见 `evidence/G6-C3/result.md`。

UI-D1 最新结果：独立指标与动态状态专项 36 项、拖放回归 15 项、统一尺寸专项 15 项均为 HTML 浏览器 E1 PASS；用户于 2026-09-24 确认该版为后续 UI/UX 基线，见 `evidence/UI-D1/result.md`。HTML 原型获批不替代 Tauri 窗口和最终产品验收。

### G4-C CPU/RAM 顺序子任务

为控制实现范围，G4-C 顺序拆为两张子卡。总体完成条件仍以 G4-C 原卡为准，子卡均完成后才能关闭 G4-C。

| 子卡 | 状态 | 允许修改 | 验证与完成条件 |
|---|---|---|---|
| G4-C1 原生采样与 IPC | completed | `app/src-tauri/src/features/metrics/**`、`app/src-tauri/src/features/mod.rs`、`app/src-tauri/src/lib.rs`（仅注册本卡 state/command）、`app/src-tauri/Cargo.toml`、`app/src-tauri/Cargo.lock`、`evidence/G4-C1/**`、本文件、`findings.md` | [结果](evidence/G4-C1/result.md)；Rust 44/44、fmt、Release check PASS；原生 UI/E4 尚由 G4-C2 验证 |
| G4-C2 共享采样消费者与摘要 | completed | `app/src/features/metrics/**`、`app/src/shell/ShellFrame.tsx`、`evidence/G4-C2/**`、本文件、`findings.md` | [结果](evidence/G4-C2/result.md)；typecheck、49/49 前端测试、隔离 Release build、METRIC-01 E4 与真实 E2 共 11 项通过，含托盘激活、CPU/RAM 面板、受控负载及隐藏/恢复后采样重启 |

G4-C1 API 口径：`GetSystemTimes` 的 kernel 时间包含 idle；Windows 超过 64 个处理器时该 API 只聚合调用线程所属主 processor group，因此该场景的全机 CPU 百分比必须返回 unavailable。RAM 统一采用 `GlobalMemoryStatusEx` 的物理总量与可用量，展示使用量为 total minus available；不混用虚拟内存或进程 Private Working Set。

## 5. G1-D WPF同内容对照（implemented_unverified）

- 前置：G0已完成；G1-B/C 已能复现同内容窗口场景。系统未安装 SDK；已在 `prototypes/wpf-shell/.tools/` 项目局部放置官方 .NET 10.0.401 SDK ZIP 解压内容，SHA512 已匹配官方发布元数据；系统 PATH、注册表和用户配置未改。WPF Release 已生成并启动。
- 允许：prototypes/wpf-shell/**、evidence/G1-D/**、task_plan.md、findings.md；测量脚本只允许修复通用缺陷；research副本只读。
- 工具准备：核对 Microsoft 官方本地安装文档与发布元数据；采用官方 SDK ZIP 和 SHA512 校验，避免执行下载脚本；SDK 仅放在 prototypes/wpf-shell/.tools/，runner 仅设置进程级 DOTNET_ROOT/PATH；不改系统 PATH、注册表或用户配置。版本与哈希见 `evidence/G1-D/sdk-manifest.json`。
- 输出：WPF 同内容摘要/输入/面板、最少定位函数与有意义的对应测试；记录 WPF/.NET SDK 版本和真实 release。当前 Release 构建 0 warning / 0 error；几何测试 5/5 PASS。E2 证据：启动不抢焦点、单实例、50次真实鼠标开合、Tab/Esc/合成草稿保留、96↔144 DPI 双屏往返、IME 合成事件计数均通过各自子项；托盘入口仍未验证。
- 对照：复用 G1-B/C 的摘要、输入、尺寸、更新频率及 P0/P1 场景和同一测量脚本；只为通用支持不同 release 路径及标记 P1 对场景阈值做最小修正；CPU/内存采样算法不变。WPF与Tauri Release的P0、空面板P1均完成120秒预热+600秒、121样本；两次P0的CPU/Private WS门槛均PASS。P0中Tauri CPU均值0.0241%（WPF 0.0414%），Private WS均值83.38MiB（WPF 52.39MiB）。P1亦已记录，但WPF P0/P1为不同进程且活动显示器从2台变1台，Tauri未记录显示器数；P1数值仅作本轮观察。GPU/唤醒未测，共享WebView树外归属未验证。
- 禁止：实现完整第二套业务产品；读凭证/私人对话/剪贴板；安装系统级 .NET SDK；把 fixture 或 mock 作为真实窗口证据。
- 未验证：托盘 Show/Exit 和退出后的残留进程检查；IME 实际中文内容展示、选区替换；SHELL-04恢复。最新托盘探测见 `evidence/G1-D/tray-navigation-probe.json`：WPF不在前台，脚本在发键前停止，`inputSent=false`。Tauri UIA `Open` 控件没有 InvokePattern，用户通过 Alt+Tab 手动打开空面板；精确 Release 的只读尺寸核对通过。P1两路线采样已完成，但跨轮进程生命周期/显示器条件有差异。较早双屏 UIA 96↔144 DPI往返已通过；最近启动时一台活动显示器，不覆盖热插拔、负坐标实体屏或睡眠/RDP。
- G1-D 状态仍为 `implemented_unverified`：WPF 原生基线、P0/P1数据和边界已足够供 G1-E 评估，但 SHELL-01/03 与 SHELL-04 缺口没有被此判断标为通过。P1数值存在进程/显示器差异；不宣称路线效率结论或用户验收。

## 6. G1-E 路线门槛与短计划修订（completed）

- 决策证据：`evidence/G1-E/decision.md`。
- 下一阶段候选：Tauri 2 + Rust + TypeScript；不整体 fork Codenotch、不直接采用 Zebar、不维护第二套 WPF 产品。
- 决策依据：用户要求独立、可自定义模块顺序的本地工具；Zebar 现成排序配置不足；Tauri 最终候选的 P0 门槛通过，P1样本已采并单独报告；WPF也通过P0但P1对照不完全同条件，且P1不应用P0门槛。
- 明确限制：G1-B 原始内存整体状态、Tauri最终哈希完整交互复验、混合DPI/恢复、WPF托盘与完整输入仍有未验证项。所有缺口保留，不因路线选定而转PASS。
- 当时 G2-A 尚未开始；这条记录保留 2026-09-23 时点，本次 Goal 2 指令已启动 G2-A。

## 7. 当前未知与阻塞

Goal 1进行中；G1-A已经建立第一个测试原型。仍有以下路线门槛与未验证项：

1. G1-B 两轮 600 秒 P0 的 CPU 子项通过，但内存 counter 样本不完整；最终改过的 counter 查询路径尚无完整 E3 重测，整体 PERF-01 保持 UNVERIFIED。
2. G1-D的双屏混合DPI UIA往返已通过；随后最近一次WPF启动时系统只报告一台活动显示器。负坐标实体屏、热插拔、任务栏变化、睡眠和RDP仍未验证。
3. G1-D的项目局部SDK、WPF Release与5项单测、若干E2子项及WPF/Tauri的P0/P1采样已完成。托盘脚本因前台锁未发送按键。P1跨轮存在WPF进程生命周期及显示器数量差异；IME文本未读取/记录，选区替换也未验证。
4. 路线候选已选 Tauri，但首版功能组合及性能预算仍是工作假设，尚未用户验收。
5. G2-A SHELL-01 已在 SHA `63DAFE33…124EAC1` 完成 E2：关闭隐藏、精确 tray 图标及 `显示主窗口` / `退出 Widget Platform` 菜单项均可由 UIA 调用；Show 恢复到 320×124 原位置并取得焦点；Exit 后精确 Release 进程退出。见 `evidence/G2-A/tray-menu-uia-e2-result.json`。未生成安装包或持久业务数据。
6. G2-UI-B E1 与 E2 完成；受保护输入、悬停概况、面板/Esc、设置、隐藏恢复、四边真实拖动和 G2-A 同哈希托盘 Show/Exit 通过。旧大窗口下底边 UIA 矩形偏移 168px 只属于历史探针事实；多屏/混合 DPI/系统恢复仍 UNVERIFIED。

## 8. 最近完成任务：G2-UI-A（completed）

- 允许：`app/src/shell/**`、隔离 UI fixture 与对应测试、`evidence/G2-UI-A/**`；不改 research 或业务模块。
- 依据：严格对照 [获批 UI-D1 v2 原型](designs/widget-platform-reference-preview/Widget%20Platform%20UI%20Preview%20v2.html)，基线哈希记录见 [资产元数据](designs/widget-platform-reference-preview/_d_meta.json)。
- 实际变更：`app/src/shell/ShellFrame.tsx`、`shell-frame.css`、`shell-layout.ts`、`shell-layout.test.ts`；新增 `app/tests/fixtures/ui-shell.html`、`ui-shell-preview.tsx`、`ui-shell-preview.css` 和 `evidence/G2-UI-A/browser-layout-check.mjs`。CSS 从获批原型抽取颜色、字体、圆角与图标槽位；统一长边/厚度，外环余量纳入槽位，窄区按行/列换行；产品默认模块没有合成读数，示例环值仅存在隔离 fixture。
- 本卡验证：`npm run typecheck -- --pretty false`、`npm test -- --run`（7/7）、`npm run build` 均 E1 PASS。Edge 153/CDP 覆盖 920×897 与 390×760、四边、34/46/52px、off/inner/outer，共 72/72 PASS；截图已与获批 UI-D1 v2 对照，记录见 [结果](evidence/G2-UI-A/result.md)、[截图对照](evidence/G2-UI-A/screenshot-comparison.md) 和 [浏览器尝试记录](evidence/G2-UI-A/browser-layout-attempts.md)。
- 失败轮根因是脚本从错误的 DOM 元素读取状态；修正后又发现并修复 dock 状态属性缺失和纵向 grid 排列问题。最终矩阵无运行时异常或 console error。浏览器 `deviceScaleFactor=1`；Windows DPI、Tauri/native 和产品验收仍为 UNVERIFIED。
- 出口已满足：四边长边/厚度共用；最小/最大图标未缩小；换行无重叠和越界。原生挂件宿主 E2 已通过，结果见第 11 节；当前共享 tray/exit 门槛见第 10 节。

## 9. G2-UI-B 四边交互与活动面板（completed）

- 依据：[G2-UI-B 卡片](开发短计划.md)与已批准 UI-D1 v2；G2-UI-A 已通过前置出口。
- 允许：`app/src/shell/**`、`app/src-tauri/src/host/geometry/**` 与窗口交互所需文件、对应测试、`evidence/G2-UI-B/**`；只增加满足交互契约所需的源码，不扩展到业务模块。
- 计划变更文件：`app/src/shell/ShellFrame.tsx`、`shell-frame.css`、`shell-view.ts` 与 `shell-view.test.ts`；扩展 `app/tests/fixtures/ui-shell-preview.tsx/.css`；新增本卡独立 E1 browser runner 与 E2 guarded UIA/mouse runner、结果和截图至 `evidence/G2-UI-B/**`。只有真实窗口交互证明需要 native geometry 时，才在已允许的 `app/src-tauri/src/host/geometry/**` 与所需窗口交互入口增加最小文件；当前不预设修改其他模块或 `research/`。
- 验证入口：E1 类型检查、shell 状态/几何单测、生产构建、独立 Edge 矩阵覆盖目标四边及 panel/settings/hidden/restore/Esc；E2 从最终 Release 精确路径启动，经 PID/foreground guard 在真实 Tauri 窗口验证四边停靠操作、悬停/面板/Esc、显示恢复与设置入口可达。缺失多屏、混合 DPI、热插拔和系统恢复结果保留 UNVERIFIED。
- 实际修改：`app/src/shell/ShellFrame.tsx`、`shell-frame.css`、`shell-view.ts`、`shell-view.test.ts`、`shell-layout.ts`、`shell-layout.test.ts`；隔离 fixture `app/tests/fixtures/ui-shell-preview.tsx`；E1/E2 runner 和证据在 `evidence/G2-UI-B/**`。未修改 native geometry 或业务模块。
- E1：`npm run typecheck -- --pretty false`、`npm test -- --run`（15/15）、`npm run build` 均 PASS；Edge 153 fixture 的四边、hover、panel/Esc、settings/Esc、hide/restore、拖放内外目标和移动端控件 8/8 PASS。结果与截图见 [E1 交互结果](evidence/G2-UI-B/browser-interaction-result.json)。
- E2 更正：SHA-256 `376F9D69E2DEB45D6ED67E8F1593354E200BC74D1EFAA47A45781C2727EF63E0` 的 10 项检查仅证明真实 Tauri 大窗口内的 React 交互通过。四边拖动未移动 OS 窗口，不能算桌面停靠通过；截图范围和边界见 [E2 结果](evidence/G2-UI-B/result.md)。原 820×520 客户区窗口和真实 window rect 见 [G2-A current Release probe](evidence/G2-A/current-release-shell-e2/native-interaction-result.json)。
- 历史纠正：SHA-256 `376F9D69E2DEB45D6ED67E8F1593354E200BC74D1EFAA47A45781C2727EF63E0` 的四边操作只移动 WebView CSS；其“桌面停靠通过”结论撤回。
- 当前 E1/E2：fixture 8/8、19/19 单测、类型检查/Release 构建 PASS；SHA-256 `63DAFE33A1E34C7ED5481F732CFB31631183855F8C31117CB51CFE1B5124EAC1` 的原生挂件 16/16 PASS，详情见 [最终 E2](evidence/G2-UI-B/native-widget-host-e2/native-widget-host-result.json)。一屏 96 DPI 四边对齐误差均 0px；多屏/混合 DPI/恢复 UNVERIFIED。
- 出口：原生挂件几何、已批准一级导航/面板、隐藏恢复通过；托盘 Show/Exit 在同一最终 Release 的 G2-A E2 复验通过。多屏、混合 DPI、显示器变化、睡眠/RDP 和系统恢复仍 UNVERIFIED。下一任务 G2-B。

## 10. G2-A SHELL-01 托盘菜单（completed）

- 依据：[G2-A 卡片](开发短计划.md)、[SHELL-01 验收标准](测试与验收标准.md)；一次处理当前卡，不提前进入 G2-B。
- 允许：`app/` 的正式 scaffold 与锁文件、`README.md`、`scripts/check.ps1`、`evidence/G2-A/**`、`task_plan.md`、`findings.md`。若发现正式 scaffold 缺陷，只做有证据的最小修复并重建 Release。
-- 当前候选：`app/src-tauri/target/release/widget-platform-app.exe`，SHA-256 `63DAFE33A1E34C7ED5481F732CFB31631183855F8C31117CB51CFE1B5124EAC1`；它包含 G2-UI-B 已通过的原生小挂件宿主。
- 本卡门槛：启动→摘要/主窗→WebView 活动面板→tray Show→tray Exit；验证单实例、菜单退出后无精确 Release 进程残留。WebView 面板/Esc 新证据见 G2-UI-B 同 SHA E2；tray 和生命周期必须在当前哈希上复核。
- 历史结果：先前哈希 `DBE52A653A9D5AC7B1CE5B633525B2018330EDD6E916E083107DECEA35574648` 的窗口交互、关闭隐藏、二次启动恢复和进程清理通过；添加 tray id/tooltip 后仍未从 Shell tray UIA 树发现精确产品图标。隐藏图标按钮 Invoke 未确认弹出状态，系统未枚举 `NotifyIconOverflowWindow` 或精确产品图标控件；普通任务栏分组按钮不作为托盘替代。该历史测试不冒充当前哈希证据。
- 最终 Release SHA `63DAFE33A1E34C7ED5481F732CFB31631183855F8C31117CB51CFE1B5124EAC1` 的 UIA E2：准确识别系统隐藏图标按钮，打开 `TopLevelWindowForOverflowXamlIsland`；在弹窗内定位唯一 `Widget Platform` `SystemTray.NormalButton` 并调用；准确定位进程 PID `49540` 的 `显示主窗口` 和 `退出 Widget Platform` `MenuItem` 并调用。Show 后真实 HWND 可见、坐标恢复为 `(1120,0,320,124)`、前台 PID 为该 Release；Exit 后进程退出。探针退出码 0，最终独立精确路径扫描无残留。证据见 `tray-menu-uia-e2-probe.ps1`、`tray-menu-uia-e2-result.json`、run log 与 exit code。
- 本卡出口满足；普通分组任务栏按钮不作为托盘替代。此前 UIA 只查 `Shell_TrayWnd` 时未发现弹窗内图标，展开独立溢出 XAML 窗口后才得到安全目标；无坐标输入。

## 11. G2-UI-B 原生桌面挂件宿主修正（completed）

- 依据：[G2-UI-B 卡片](开发短计划.md)、[产品四边停靠需求](产品需求文档.md)、[窗口尺寸/几何架构约束](架构说明.md)和已批准 UI-D1 v2；这是纠正实现与证据范围，不改变产品设计基线。
- 允许：`app/src/shell/**`、`app/src-tauri/src/host/geometry/**`、必要的 Tauri 窗口配置/capability 与前端入口、对应测试、`evidence/G2-UI-B/**`、本计划及 `findings.md`。禁止修改 `research/**` 和无关模块。
- 历史事实：旧 Tauri Release 为居中 820×520 客户区、带系统标题栏、不透明、非置顶窗口；React 四边操作只移动客户区 CSS。该旧 Release 的 E2 结论已撤回。新实现现已由下列 E2 验证为沿屏幕四边定位的真实小型原生挂件。
- 实施目标：启动显示紧凑挂件，不抢焦点；去除标题栏和不透明大窗口背景；四边状态改变真实窗口宽高与位置；拖动控制启动真实原生移动并按释放位置贴到最近边；打开概况/活动面板/设置时按内容所需扩窗，关闭后收回；隐藏/恢复保留已选边缘与比例。窗口 API capability 只添加实际使用的权限。
- E1：几何函数覆盖四边、负坐标、比例和显示器工作区；shell 单测、类型检查及生产构建通过；fixture 仍单独保留已批准设计预览。E2：从本轮最终 Release 启动，在窗口前台保护下检查标题栏/客户区/透明角，拖动四边并读取 `GetWindowRect` 与 monitor work area，证明 OS 窗口外框实际贴边；打开/关闭概况和活动面板，确认内容完整且窗口可回收；检查启动不抢焦点、托盘仍可用、退出无自有进程残留。未覆盖的多屏、混合 DPI、睡眠/RDP与系统恢复单列 UNVERIFIED。
- 最终 E1：TypeScript 与生产构建 PASS，19/19 单测，Edge fixture 8/8；最新 UI-D1 v2 截图复核见 `evidence/G2-UI-B/native-screenshot-review.md`。
- 最终 E2：Release SHA-256 `63DAFE33A1E34C7ED5481F732CFB31631183855F8C31117CB51CFE1B5124EAC1`，探针 16/16 PASS。命令 `run-msvc-rust.cmd npm run tauri -- build --no-bundle`，cwd `app/`，构建退出码 0；探针 `evidence/G2-UI-B/native-widget-host-probe.ps1`，cwd 根目录，退出码 0。原始 rect/work area、点击过程、前台保护和精确路径进程清理见 `native-widget-host-e2/native-widget-host-result.json`。
- E2 范围：单屏 96 DPI；标题栏/客户区矩形、置顶、四边实际 `GetWindowRect`、悬停/活动面板/Esc、设置/换边、隐藏/恢复通过。G2-A 在相同 SHA 上补齐 tray Show/Exit 与退出清理。多屏、混合 DPI、显示器变化、睡眠/RDP 和系统恢复 UNVERIFIED。

## 12. 已完成任务：G2-B 设置与内容入口（completed）

- 依据：[G2-B 卡片](开发短计划.md)、CFG-01、UI-01、SHELL-03、获批 UI-D1 v2。G2-UI-B 与 G2-A 已通过。
- 允许：`app/src/shell/**`、`app/src-tauri/src/host/**`、settings 模块、对应 tests、`evidence/G2-B/**`、`task_plan.md`、`findings.md`；共享入口仅做必要注册，不改 `research/**`。
- 全卡范围：静态 ContentId 列表；启用/顺序/edge 配置；已批准原型中的共用卡片长边/厚度、独立图标大小、“始终显示/隐藏显示”两种显示方式；仅列出 shell 中有真实入口/空状态实现的六个基础 ContentId，不加入 media/weather 示例模块；设置原子写入并把失败呈现给用户；损坏配置保留诊断副本；摘要白条及托盘可找回；不开机启动；存储位于应用专属的 per-user 本机目录，测试目录可注入。原文档要求 LocalAppData；用户已明确批准仅 shell 设置改用非 EFS 路径。
- B1 状态：completed。实际文件：`settings-model.ts`、`settings-model.test.ts`、Cargo.toml/lock、`src/lib.rs`、`src/host/mod.rs`、`src/host/settings.rs`。Rust `cargo test` 8/8 PASS，store 覆盖路径注入、默认/合法读写、原子替换失败保留旧文件、成功替换和坏 JSON 诊断副本；TS model tests 24/24 PASS、TypeScript typecheck PASS；`cargo fmt` PASS。日志见 `evidence/G2-B/b1-*`。Rust linker 有 MSVC 创建 `.lib/.exp` 的既有 informational warning。
- B2 当前子任务：把 B1 settings load/save 连接到 shell；实现 UI-D1 v2 的模块顺序、edge、共用尺寸、图标尺寸与两种显示方式；保存状态/失败消息可见；原生窗口按设置调整大小并在同哈希 Release 重启验证。允许：`app/src/App.tsx`、`app/src/shell/ShellFrame.tsx`、`shell-frame.css`、`native-widget-window.ts`、相关 shell tests、`app/src/settings/SettingsPanel.tsx`、`settings.css`、对应 tests、`evidence/G2-B/**`、本计划/findings。拟改实现文件 6 个（App、ShellFrame、shell CSS、native size integration、SettingsPanel、settings CSS）；测试只加必要的尺寸/交互覆盖，不新增依赖或改 capability。
- B2 验证：UI-01/CFG-01/SHELL-03 对照 v2；真实 Release app-data 保存→重启一致，磁盘写入故障时原配置保留且界面提示可见。每项按 E1/E2 记录；多屏/DPI/故障恢复未覆盖保持 UNVERIFIED。
- B2 验证：UI-01/CFG-01/SHELL-03 对照 v2；真实 Release app-data 保存→重启一致，磁盘写入故障时原配置保留且界面提示可见。每项按 E1/E2 记录；多屏/DPI/故障恢复未覆盖保持 UNVERIFIED。
- B2 存储路径决策：AppData 与 LocalLow 均启用 EFS；profile 根目录本身未启用 EFS。用户授权后设置改为 `%USERPROFILE%\.widget-platform\<bundle identifier>`，Rust 同目录新建/覆盖 rename 探针 PASS；运行时拒绝误用带 EFS 的目录。该路径只存 shell 偏好，不把后续业务数据迁出架构规定的用户内容库。
- B2 最终验证：Release SHA `A9EE73282946BC52AD0E9A5595059DB7322E6A9983C1A1B693621AFCB1A7A24A`，E2 13/13 PASS：紧凑挂件启动 320×166、设置页 440×520；模块顺序、edge、420/96/40 尺寸真实保存；重启恢复右边 140×480；隐藏条 44×48 重启后可找回；恢复后回到 140×480；锁定 settings.json 时旧 SHA-256 完全不变，UIA alert 可见。runner exit 0。首次 E2 因 UIA bounds 将恢复按钮左缘越出原生窗 4px 而拒绝输入；按按钮中心仍须位于精确窗口的守卫后复跑全套通过。证据：`evidence/G2-B/retry-non-efs/b2-e2-persistence-result.json`、`runner.log`、`runner-exit-code.txt`、四张对应截图、`b2-non-efs-rename-probe-result.json`。
- E2 后清理：测试前 settings.json 不存在；完整通过后仅将精确生成的 `%USERPROFILE%\.widget-platform\com.widgetplatform.desktop\settings.json`（E2 记录 hash `0D8BC3…3B5F7C59`）移入回收站。保留应用目录和证据；旧 EFS 目录未写入；Release 精确进程无残留。多显示器/混合 DPI/系统恢复仍 UNVERIFIED。
- 全卡完成：`evidence/G2-B/**` 保存实际命令、退出码、日志、原始结果和截图；满足 G2-B 后停止在卡片出口，再更新到 G2-C。

## 13. 已完成任务：G2-C IPC 与模块生命周期（completed）

- 依据：G2-C 卡片、IPC-01、LIFE-01、架构说明 §4/§5；前置 G2-B 已完成。
- 实际变更：`app/src/shared/counter-store.ts`、`counter-bridge.ts`、开发/验收探针 `CounterProbe.tsx` 与同步测试；`app/src-tauri/src/host/counter_probe.rs`、`host/mod.rs`、`src/lib.rs`；`app/src/App.tsx` 开发/验收入口；`Cargo.toml` 的无依赖 `g2c-probe` feature。无 Event Bus、无通用插件/框架，counter 未注册为 Todo/Timer 等产品模块。
- IPC 与生命周期：监听先于快照；同步期间有界缓冲同 instance 的最新事件；首次快照确定权威 instance；重复/旧 revision 与旧 instance 事件不覆盖状态；并发连接有 generation guard；命令与 Rust 错误使用 `code/message/retryable`。Rust 用可取消 Condvar 等待和 join 句柄；重复启用幂等，禁用前取消并 join；UI 草稿保持独立于快照。
- E1：TypeScript 6 个测试文件 35/35，typecheck 退出码 0；Rust 12/12 tests，fmt check 退出码 0。涵盖快照先后、乱序/重复、instance 重连、重叠连接、无效/失败 IPC、草稿保留、100 次 enable/disable 且 worker 计数每轮回到 0。
- Release-profile 原生 E2：命令 `run-msvc-rust.cmd npm.cmd run tauri -- dev --release --no-watch --features g2c-probe --config ..\evidence\G2-C\dev-probe.tauri.json`；真实 target/release Tauri host、测试页面由 Vite devUrl 提供。精确 Release PID 51008、SHA `EEFC408942F61A8A83B1DDB02904A9F3C325D3656E84C7D48AFB571DCDC0377F`；8/8 PASS：真实 command snapshot、后台 changed event 更新、草稿保留、100 次启停、卸载消费者、重新取权威快照及 instance `51008-100 → 51008-101`。随后 Ctrl+C 停止测试会话；PID 与 E2 记录的 6 个自有 WebView PID 均退出。结果、脚本、截图及退出码见 `evidence/G2-C/native-ipc-lifecycle-e2-result.json`、`native-ipc-release-e2-final-run.log`、`native-ipc-live-counter.png`、`native-e2-process-cleanup.json`。
- 最终产品 Release：无 Cargo feature、`VITE_G2C_PROBE` 未设置，`tauri build --no-bundle` 退出码 0；SHA-256 `2539180926321D6A930528C07379356B1D52C9A811D9840FE18BB3DC87FC8FCF`。产物前端 JS 与 EXE 均无探针标记/command 符号。该最终 SHA 的 UIA 原生 tray E2 回归通过：启动未抢前台、Close 隐藏、tray Show 恢复到 `(1120,0,320,166)`、tray Exit 结束精确进程。见 `release-audit.json`、`final-release-tray-regression.json`。
- 限制：Release-profile IPC E2 用验收 feature 与 Vite devUrl；最终无 feature Release 的静态前端没有合成 counter，故没有把探针 E2 误称为最终产品 bundle 的 counter 验收。UIA 在重连后实际读到新 instance revision 46，revision 1 snapshot→revision 2 event 的边界由 E1 单测直接验证。最终静态 Release 已 E1 构建/剔除审计，并同 SHA tray E2 回归；额外 compact-window smoke 的子进程清理守卫失败，不计为通过，见 `evidence/G2-C/attempts.md`。混合 DPI、多显示器热插拔/睡眠恢复及整体用户验收仍保持各原任务中的 UNVERIFIED。Windows linker 输出一条 `linker_messages` 提示；最终 build 和 tests 均退出码 0。
- 文档/原始记录：`evidence/G2-C/result.md`、`attempts.md` 保存命令、退出码、重试与限制；F-051 记录可复用发现。G2 已完成，本轮停止于 G2，不开始 G3。

## 14. Goal 3 continuation review (2026-09-26)

- 本轮仅复核 G3 范围；未扩展到 G4。
- E1 复核：`app/` 中 `npm.cmd run typecheck -- --pretty false` PASS；`npm.cmd test -- --run` PASS（8 files / 43 tests）；`npm.cmd run build` PASS。Rust `cargo test --manifest-path src-tauri/Cargo.toml` PASS（33 tests）；Release `cargo check` PASS。MSVC 打印一条既有 `linker_messages` 提示，命令退出码为 0。详细摘要见 `evidence/G3-B/continuation-review.md`。
- 早期 gap probe 的坐标版本仍保留为历史 UNVERIFIED：其顺序断言未满足，且 computer-use 输入不能证明拖动动作已正确执行。该历史解释见 `evidence/G3-B/todo-drag-probe-interpretation.md`；旧 runner 会重置 `evidence/G3-B/gap-profile` 的风险见 F-057，不再作为当前结论。
- 后续隔离 Bundle ID 的真实 Release E2 已确认 Todo 手柄命中、按下进入“正在调整”、连续原生移动与释放、顺序变为 B/A/C，并在重启后保序；同一 Release 的独占 SQLite 锁拒写、草稿保留、旧状态保留和解锁后单次重试也通过。证据分别见 `evidence/G3-B/todo-drag-sendinput-20260925-133626-787.json` 与 `evidence/G3-B/todo-refused-write-20260925-141941-157.json`，产物 SHA-256 为 `6E1EAF53B5F306FBD90D2C1AA791867B55FBA2D7A6607078DF8A33E755A81228`。
- 独立 Bundle ID 的 Timer Release 真实进入 Windows S3 并由 waitable timer 唤醒，实际系统 tick 跨过 deadline 后只完成当前 Focus 阶段；面板重开和进程重启保持同一 `completionId`，expire action 数量为 1。证据见 `evidence/G3-D/timer-sleep-e2-20260925-143734-323.json`，产物 SHA-256 为 `EB7B1EC32BD0D069F64D82AB35D48012BE21FDC4CD7DC12A594BEAAA8E428E20`。
- 当前结论：G3-A、G3-B、G3-C、G3-D 均为 `completed`，Goal 3 必需任务完成。多显示器/DPI、RDP、系统通知被拒绝和 E5 用户验收仍按各结果文件保持 UNVERIFIED，不把这些边界写成 Goal 3 通过项。
- 下一步进入 G4 或其他已排入的任务；G8 性能、制品和 E5 用户验收仍待后续启用范围完成。

## 15. G4-A Media native bridge (2026-09-26)

- 状态：`completed`。E1 与授权真实来源 E2/E4 均有证据；G4-B 已进入执行。
- 变更文件：`app/src-tauri/Cargo.toml`、`app/src-tauri/Cargo.lock`、`app/src-tauri/src/features/mod.rs`、`app/src-tauri/src/features/media/{mod.rs,model.rs,unsupported.rs,winrt.rs,tests.rs}`、`evidence/G4-A/{result.md,attempts.md,*.log,*.txt}`、`findings.md`。
- 实际命令，cwd `app/`，由 `run-msvc-rust.cmd` 调用：`cargo fmt --manifest-path src-tauri/Cargo.toml --check` exit 0；`cargo test --manifest-path src-tauri/Cargo.toml` exit 0（38 passed/0 failed）；`cargo check --release --manifest-path src-tauri/Cargo.toml` exit 0。完整记录见 `evidence/G4-A/`。
- E1：PASS；默认 suite 为 46 passed/0 failed/1 ignored，`cargo fmt --check` exit 0；`cargo check --release` exit 0（Release 检查耗时约 2.21s）。最近日志为 `evidence/G4-A/e1-session-source-fallback-20260926-*`。
- E2/E4：PASS（本机网易云客户端与 Edge 视频，专用只读 GSMTC probe）。此前一次运行实际读到“文字存在但封面读取失败”，随后同一封面引用重试成功；最新成功轮读到两路来源、两路封面、1 次 current-session 切换、网易云暂停、Edge 会话关闭/移除、`sessionIdentityChurns=0` 和 `monitorStopped:true`，cargo test exit 0。日志只输出媒体字段存在性，不输出标题/艺术家/专辑正文。代码在会话移除和 monitor stop 时显式移除 event tokens，并 join worker；本轮观测到会话移除及正常 stop。运行没有覆盖 100 次 UI 显隐循环，该类消费者生命周期仍由 G4-B/LIFE-01 继续验证。
- 卡片出口：满足；进入 G4-B。真实媒体控制命令尚未获单独授权，因此只读 UI/数据显示可先实现，触发播放、暂停、切歌和 seek 的桌面 E2 暂缓到明确授权后。
- 2026-09-26 窗口核对：G4-C2 Release 已打开（PID 23316），但无媒体图标/面板；该启动不是 MEDIA-01 证据。G4-A native bridge 后续已在第五轮只读 probe 通过；正式媒体 UI 属当前 G4-B。记录：[app-open-check](evidence/G4-A/app-open-check-20260926.md)。
- 2026-09-26 用户恢复后运行第五轮：初始快照识别 `MSEdge` 和 `cloudmusic.exe` 两路 Playing；用户暂停网易云并关闭 Edge 视频页。结果 `currentSessionSwitches=1`、`sawPaused=true`、`sawClosedOrRemoved=true`、`sessionIdentityChurns=0`、`monitorStopped=true`；test exit 0，标题/艺术家/专辑正文未写入日志。此前实际观察到的文字+封面失败作为同一 MEDIA-01 的累计证据保留。G4-A completed；当前切换 G4-B。

## 16. G4-B Media interaction

- 状态：`completed`（用户于 2026-09-27 明确以 E5 验收当前范围）。严格沿用获批 UI-D1 v2；媒体一级入口、会话面板与按会话控制已完成。
- G4-B1（completed）：`MediaRuntime` 惰性订阅/释放、只读 snapshot/artwork 命令和有消费者引用计数的前端 store。6 个 TS 单测、类型检查通过；Rust fmt、46/0/1 默认套件及 Release check 通过。证据：[G4-B1 result](evidence/G4-B1/result.md)。没有可见 UI，没有触发控制。
- G4-B2（completed）：schema v1 内存迁移到 v2 并为旧配置补入媒体；v2 保留用户显式关闭媒体的选择。ShellFrame 按真实播放状态显示媒体一级图标，面板只读展示真实会话、元数据、封面和可用进度，支持在多会话间选择，并有无会话状态；无演示媒体数据，无实际播放控制。证据：`evidence/G4-B2/result.md`。E1 全前端 61/61、Rust 47/0/1、Release 检查及正式 Release 构建通过。真实 Release UIA 只读 E2 确认两个来源可切换且均显示正在播放；Edge 有进度时间线和封面，网易云时间线与封面不可用，面板正确显示进度不可用状态。无媒体正文进入证据。
- G4-B3（completed，E5 user accepted）：按指定 `session_id` 执行 play/pause/next/previous/seek；按钮按 capabilities 禁用，seek 使用 100ns↔ms 转换及区间 clamp，不引入全局媒体键 fallback。B3a/b 代码与 E1 完成；真实支持操作、网易云无 seek 能力状态及会话隔离已 E2/E4 验证。用户报告真实视频暂停/播放/下一集可用，关闭网页后媒体会话消失、重开后恢复，并明确要求本卡记通过。Provider false/异常未被真实观察；用户接受该残余覆盖缺口，不虚报 E2/E4。总结果：`evidence/G4-B3/result.md`、`evidence/G4-B3/b3-e2-e4-control-results.json`。
- G4-B3a（completed）：实现按 session ID 定向的原生 play/pause/previous/next/seek 命令、异步 bounded worker 请求、错误/超时/false 结果保留、capability 检查和 seek 区间 clamp；E1 Rust 51/0/1、fmt 与 Release check 通过。真实支持操作结果见 E2/E4 证据。证据：`evidence/G4-B3/b3a-result.md`。
- G4-B3b（completed E1/E2 partial）：实现媒体面板控制按钮、能力禁用态与拖动/键盘提交 seek；控件绑定所选 session ID。前端 63/63、类型检查及 Vite/Tauri Release build 通过；UIA 能力/生命周期检查通过。暂停/播放/切歌/seek 成功路径和 session isolation 实时核验通过；provider false/异常仍 UNVERIFIED。证据：`evidence/G4-B3/result.md`。
- 2026-09-27 用户授权的单次失败探测：网易云当前播放会话的 pause 返回 accepted，状态变为 paused；一次 play 恢复返回 accepted，最终状态 playing。没有 provider false/exception；不再对该会话做破坏性故障注入。脱敏 E2/E4 记录：[probe](evidence/G4-B3/live-failure-attempt-20260927.json)。
- 出口：满足用户明确 E5 验收，G4-B 与 Goal 4 均关闭。provider `false`/异常没有自然出现，未做故障注入；此真实播放器分支保留为未覆盖项，用户接受以当前范围通过。下一张计划卡为 G5-A，当前未启动。
- G4-B3 允许范围：`app/src/features/media/**`、`app/src-tauri/src/features/media/**`、必要的 Tauri command registration、相应单测及 `evidence/G4-B3/**`。用户授权的网易云与 Edge 成功路径/隔离有 E2/E4 证据；视频页关闭/恢复由用户自测报告并按 E5 接受。真实 provider false/异常仍未验证，作为用户接受的覆盖限制。

## 17. G3-E Todo 摘要状态接入（复核补充卡）

- 状态：`completed`（2026-09-27）。首轮接入与独立复核跟进均完成；最终只读复核无阻断。当前监听 API 没有已注册 listener 的断线/健康通知，因此真实 Tauri 故障恢复与静默 listener 断线检测明确保留为 UNVERIFIED，不作通过声明。PRD §5 和已批准 UI-D1 v2 已包含摘要状态行为，无需新增或改写产品需求/原型。
- 前置：G3-A/B；G2 Shell 与 Todo store 已完成。当前正式窗口使用的版本保持不动。
- 允许文件：`app/src/shell/ShellFrame.tsx`、`app/src/shell/shell-frame.css`、`app/src/features/todo/TodoPanel.tsx`、`app/src/features/todo/todo-panel.css`、`app/src/features/todo/todo-store.ts`、`app/src/features/todo/todo-store.test.ts`、`app/src/features/todo/todo-summary-model.ts`、`app/src/features/todo/todo-summary-model.test.ts`、`evidence/G3-E/**`、`task_plan.md`、`findings.md`、`开发短计划.md`、`README.md`。
- 验收：首轮隔离 Release E2 记录 0/1→1/1、面板关闭后保持、3 秒对号/数量交替、删除回到 0/0；复核版本实际捕获空列表 0/0。跟进 E1：模型 8/8、Todo 子套件 13/13、前端 72/72，typecheck、生产 build、默认 Tauri Release build PASS；fake-timer 覆盖 retryable 快照连接失败后的 5 秒重试、状态 failed→syncing→ready 与缓存保留。独立只读复核无阻断；真实 Tauri 故障恢复 E2、已注册 listener 静默断线检测 UNVERIFIED。
- 隐私/生命周期：Shell 与 TodoPanel 共用单个 `TodoSnapshotStore`；Todo 隐藏/禁用/设置遮挡或卸载时断开，待重连 timer 随 disconnect 取消。首轮唯一 Bundle ID 的测试 Todo 已在 UI 删除；其 AppLocalData 仍保留 `EBWebView` 与空列表数据库，清理守卫拒绝递归删除。本次 recovery probe 只读到 0/0，未新增测试项；其独立数据目录 `C:\Users\czk\AppData\Local\com.widgetplatform.g3e.todorecovery.20260927` 也留有 WebView/数据库文件，未递归清理。正式 Todo 数据未读写；哥哥原打开 PID 12448 仍运行 G4-B3 隔离版，未替换或关闭。
- 下一步：G3-E/Goal 3 已关闭；下一张计划卡 G5-A 保持 `not_started`。本任务未启动 G5，未生成安装包或完成全项目用户验收。若后续需求需要已注册 listener 的断线检测，先补充原生桥健康/断线信号与对应验收标准，再扩展重试实现。

## 18. 当前续行任务：G1-D-F1 WPF 托盘生命周期补测（blocked）

- 依据：Goal 1 已完成路线评估但 G1-D 仍 `implemented_unverified`；用户于 2026-09-27 指示先继续 Goal 1 的未验证项。G1-D 卡允许 WPF 原型与 `evidence/G1-D/**`，本续行只补真实 `SHELL-01` 托盘 Show/Exit 和退出清理，不扩成其他路线任务。
- 前置已核实：目标 Release EXE 为 `prototypes/wpf-shell/WpfShell/bin/Release/net10.0-windows/WpfShell.exe`，SHA-256 `19F49676FCA2239BC03FA696BE07821E5EDFA2CDA435F4C12E315AE81AB0A34E`；当前无该进程；只有一块活动显示器。正式应用与其数据不触碰。
- 允许：只启动并操作上述精确 WPF Release；必要时仅在 `prototypes/wpf-shell/**` 修复经复现确认的缺陷；新增本轮独立、时间戳证据到 `evidence/G1-D/**`；更新本文件与 `findings.md`。不覆盖历史 `tray-navigation-probe.json` / `launch-probe.json`。
- 验证：对唯一精确 Release 进程检查真实 tray 图标；调用 `Show summary` 并确认窗口显示；再调用 `Exit`，确认精确 PID 退出且没有该 Release 自有残留进程。每一步均以 UIA/窗口与进程读回证明，不对其他托盘图标或窗口发送输入。
- 停止条件：目标窗口/托盘控件身份不唯一、前台归属守卫失败、UIA 无法确认目标或需要触碰非目标进程时立即停在输入之前并记录 UNVERIFIED；不得用普通任务栏按钮替代 tray。保留旧证据不覆盖。
- 实际结果：第一次直接启动 EXE 未带项目局部 `DOTNET_ROOT`，出现 .NET 运行时提示；没有下载/安装，关闭该提示。随后使用项目局部已验证 .NET 环境启动精确 Release：PID `37540`、SHA-256 与前置一致。界面显示 `SYSTEM SAMPLE / Ready · 23% / Open`，这是 `G1-D` WPF 路线对照原型，不是当前 Tauri 产品 UI。哥哥指出旧 UI 后立即暂停；`launch-probe-g1d-f1-20260927.json` 记录 `buttonHitBelongsToWpf=false`，因此没有继续输入或托盘操作。精确 PID 已结束且 WpfShell 窗口不再匹配；截图为 `evidence/G1-D/g1d-f1-old-ui-20260927.png`。本卡 E2 未通过，仍 UNVERIFIED。
- 本轮工具改动：`launch-probe.ps1` 增加可选 `-OutputPath`，默认行为不变，以便后续新证据不覆盖旧 `launch-probe.json`。
- G1-D 总卡在本续行后仍按 SHELL-03 实际中文文本/选区替换、SHELL-04 恢复及其他原边界判断；本次单项通过不自动关闭 G1-D 或 Goal 1。

## 19. 每轮更新模板

~~~text
任务ID：
状态：
实际变更文件：
执行命令与cwd：
证据路径/等级：
PASS/FAIL/UNVERIFIED：
未验证原因或具体阻塞：
是否满足出口：
下一任务与前置：
~~~


