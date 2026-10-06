# Findings：事实、决策与未知

## G8-C-F11 设置窗缩放命中错位诊断（2026-10-05）

- 用户报告设置窗不能拖动边缘缩放。隔离 fresh Release E2 复现：原生缩放本身可用（East 边中点 +105 宽、右下角 inset8 双轴 +191/+94，均 left/top 不变），但**命中区与可见角错位**，所以表现为抓不到。
- 根因三条叠加：①`.shell-settings-panel.settings-window` 用 `calc(100% - 12px)`，可见面板比真实窗口四周小 6px（`shell-frame.css:826-834`）；②Windows 原生缩放命中带只有真实窗口边 ~`SM_CXFRAME`(≈4px)，面板角在内侧 6px 已出带（`tauri-runtime-wry-2.11.4/src/undecorated_resizing.rs:299-321`）；③`.resize-south-east` 外侧约 5px 被父面板 `overflow:hidden`+`border-radius:16px` 裁掉，实测距角 1–4px 命中裸 DIV、6px 起才命中手柄。
- 次要问题：`max-width:620px;max-height:700px` 把面板封顶，窗口放大后面板不跟随（E2 实测窗口 1224×1032 时面板仍 620×700）。
- 哥哥当前安装版 `D:\app\Widget Platform`（2026-10-04 21:04，SHA `86eaaf43…2691ae`）早于 F10 缩放改动（2026-10-05 12:37），体验的很可能是不含 F10 的旧包；需哥哥确认后再定改代码/换包。
- 本轮只诊断、未改产品代码、未安装、未读私密数据。证据见 [evidence/G8-C-F11/result.md](evidence/G8-C-F11/result.md)。
- **修复已完成（同日）**：面板改为贴边 100%、去封顶；缩放手柄改 `position:fixed` + `createPortal` 到 `document.body` 逃出面板圆角裁切，角手柄 22×22 覆盖 16px 圆角。隔离 fresh Release 与正式打包 EXE 真实鼠标 E2 均通过（右下角 inset2 放大/缩小、东/西边，left/top 固定）。全前端 47/285、typecheck/build、Rust 检查 PASS；哥哥恢复外网后 `scripts/release.ps1` **完整重跑全绿**（13 步全 exit 0）。交付 `evidence/G8-C-F11/delivery/Widget Platform_0.1.0_F11_x64-setup.exe`（SHA `ecf83571…4f87fba`），构建证据 `evidence/G8-C-F11/build-final/20261005T082522317Z/`。正式安装/E5 未执行。详见 [fix-result.md](evidence/G8-C-F11/fix-result.md)。

## G8-C-F10 设置窗缩放与玻璃效果复核（2026-10-05）

- 用户真实反馈：拖动右下角时整窗跟随鼠标，说明 F9 的静态接线不足以证明 native resize 命中；源码 `.resize-south-east` 原热区为12×12px，且只有 E1/构建，没有真实桌面 E2。
- F10 的透明度/玻璃改动已撤回，不属于用户授权范围；设置窗口原有背景和不透明度恢复。当前只保留 resize 命中区与 pointer 事件隔离修复。
- F10 当前需要重新验证：右下角事件是否只调用 `SouthEast` 原生缩放、是否不再进入标题栏拖动链；左上角固定仍必须由隔离 fresh Release 的 E2证明。

## G8-C-F9 导航布局与设置窗口交互复核（2026-10-05）

- 移除透明度控件后，`SHELL_TRAILING_CONTROL_SIZE=36` 仍被 `calculateShellLayout` 计入最小长边/每行容量，且 CSS 为顶部/底部 right padding、左右方向 bottom padding 继续加同一占位；现已移除契约字段与padding，使可见模块组单独居中。Shell齿轮仍是外侧控制，不加入网格容量。
- 无装饰透明设置窗此前仅标题文本按钮调用 `startDragging`，chrome 空白没有拖动handler；现由整个header处理，先排除窗口按钮。
- Tauri 2.11.1 API 存在 `startResizeDragging(direction)`；设置窗口此前虽 `resizable: true`，却没有 resize handler/hit region/capability。现添加边缘/底部角 hit regions 和仅 settings label 的 resize ACL。顶部角缩放不提供，避免和标题栏/最小化关闭按钮争用。
- 材质控件现按互斥模式显示；`solid` 不显示滑块，`translucent` 只显示 dock opacity，`glass` 只显示 blur。真实 Release 鼠标拖动、缩放与滚动条冲突仍需 E2 验证，本轮只完成 E1/构建。

## G8-C-F8 外观材质归属与阴影修订（2026-10-05）

- 当前实现已将导航条透明度入口移除，外观设置页承载透明度、普通背景/半透明/模糊玻璃材质和玻璃模糊强度；新增字段按旧设置缺省值解析，不提升 schema 版本。
- `glass` 由 Shell CSS 的 `backdrop-filter`/`-webkit-backdrop-filter` 实现，模糊强度与透明度独立；导航条阴影从 `0 18px 28px` 降为浅色 `0 8px 18px rgba(0,0,0,.10)`、深色对应低扩散值。真实 Windows 视觉效果仍需 fresh Release/E2 复核。
- 本轮前端定向 19/19、全量 47 files/281 tests、typecheck/build、Rust fmt/test/check 均通过；未自动安装、未读取正式私密数据，E5 仍未验证。

## G8-C-F5 四边预览纠偏与新包（2026-10-04）

- F4把“收紧透明窗口”错误转成“隐藏非候选目标”，和产品四边可发现性冲突。保留四个小型鼠标穿透窗口即可兼顾目标提示与紧凑原生边界，不需要全屏透明层。
- 预览尺寸必须按目标边分别计算，而不是把拖动前横向host尺寸复用到四边；可见dock与控件透明留白分离。统一物理矩形用于绘制/命中，去除宽泛边缘band；释放重新读cursor，不能用80ms前候选。
- 显式native drag生命周期补齐“不移动直接松手”：仅靠moved debounce不会结束。按真实左键释放提交；show/update/close队列+revision防迟到回调重新显示，dispose后的异步释放结果不提交。相关RED保留，GREEN与fresh构建重跑。
- 哥哥运行的是默认Release路径，不能覆盖/强关。另设本卡cargo target并复制安全缓存；独立identity、三env一致及KnownFolder读回后测native，最后构建正式identity包。两同名托盘不唯一，仅精确回收自有PID/path/SHA/creation-time，不能叫正常退出PASS。
- 全前端260/Rust147（4 ignored），独立native四方向/47检查PASS（5安全模块/1排/144 DPI）。新installer e004cebb…0cc5020，交付副本哈希一致。169源码/配置/工具基线164不变、5修改+3新增；SVG未采样，不误标新文件。11自有进程/9251回收，哥哥18084保留。正式安装/E5、final raw同SHA桌面、多排native矩阵、多屏/原生Esc/旧延期未验。见 [本卡结果](evidence/G8-C-F5/result.md)。

## G8-C-F3 首次悬停修复与fresh包（2026-10-02）

- enter先算compact坐标、resize未重算的根因已按intent/ready/实测重算修复；纯定位整条向内侧锚定，空间不足不可夹回dock。DOM布局后幂等更新、native按preview实高预留，不靠任意delay/z-index。
- ready key必须带hover意图代次，几何数值相同不等于同一次原生请求已完成；A→退出→A在旧native回执复用下E1会提前visible，定向RED→GREEN补齐。
- 真native矩阵又复现Esc关闭面板后的programmatic focus制造预览，鼠标本来已在外面没有新的leave事件；只抑制恢复focus期间hover，仍保留普通Tab入口/恢复焦点。E1 RED→GREEN、全回归和最终新SHA矩阵全部重跑，不沿用修复前c08488db…e4fd76记录；重建的独立版875eba63…26c4437与最终正式版1b24412c…71cbaad分别有新证据。
- native测试入口应先激活窗口并真实点击设置，不能把inactive CDP动作当点击成功；大量矩阵分批保存并按同SHA/PID继续，155是检查记录（153唯一名字）、16才是矩阵case数。PowerShell5的ConvertFrom-Json数组经@()可套一层，且[string]参数不能承接解析array；快切计数错误保留、类型诊断后50真实移动通过。
- 隔离必须先读回KnownFolder并核对自有DB目录，不能仅凭USERPROFILE变量名。三env一致后的fresh子进程GetFolderPath确在profile内，独立/正式ID自有DB也在那里；只改USERPROFILE的首启stalled，不照此启动正式ID。path resolver IPC失败不扩权限；源码/系统metadata/目录三证据替代，不读任何原库正文。
- 全前端241/Rust146（4 ignored）；独立和final raw各四边×1–4排16组合、final50快切/图标34–52边界/重启/三个正常tray各7进程回收PASS，结束widget/9247均0。187基线183不变、4修改+3新建；新installer a93ab1b0…8f8e23f，raw1b24412c…71cbaad。未安装新包/E5与旧延期项仍UNVERIFIED。见[G8-C-F3](evidence/G8-C-F3/result.md)。

## G8-C-F3-D：首次悬停与切换定位差异（2026-10-02）

- 用户发现条外首次移入与图标间切换表现不同。独立native真实鼠标三轮复现：首次在124px高viewport计算出top12，随后viewport变240而top仍12；切换重算成75。20项被动几何/事件记录与截图支持，不从单图猜根因。真实tooltip高约98.64，原代码假定116；整条bottom80，切换后5px压边是button.bottom而非dock.bottom的附加问题。
- 调用顺序证实showPopover先读旧stage并夹取，再dispatch hover触发async扩窗；resize仅setStageSize，不重新提交popoverPosition。修复需hover intent/定位分离、native完成及DOM重算、真实tooltip尺寸、整体dock向内侧锚定、足够native预留空间与revision/press保护，不用z-index/固定偏移/延时掩盖。
- native验证要覆盖“第一进入→resize→未再进入”连续过程并断言矩形不相交，不能仅查tooltip出现/移开消失；前轮F2的55项没有覆盖此新增不遮挡条件。多排/四边/长文本还需修复阶段矩阵，不把顶部复现当全矩阵通过。
- 本轮只写诊断证据与进度；用户正式实例继续运行，不读Codex/天气/Clipboard/媒体。因为同名托盘歧义，精确回收7个自有过程，不声称正常托盘退出。初次about:blank导致page匹配失败的日志保留，正式页面加载后完成复现。见[G8-C-F3-D](evidence/G8-C-F3-diagnosis/result.md)。

## G8-C-F2 四项反馈与fresh包（2026-10-02）

- 默认三排并非固定3×3 CSS，而是native尺寸计算把可用长边夹回用户旧260px；改为monitor可用空间，共享排数/均衡位置后1/2/4排、重启保持均取得final raw E3。旧无rows设置读为1，不改Clipboard隐私迁移。
- 悬停清理的 focused guard 与 blank dock guard 均在真实组件handler E1复现RED；移除错误分支、整窗leave并保留press/revision保护，final raw五轮真实鼠标及活动面板不自动收回通过。哥哥明确澄清的是自动消失，不沿用先前反向理解。
- Codex旧入口只接受测试环境变量，普通安装没有该变量；本机原生exe确在OpenAI/Codex/bin的version子目录。保留显式覆盖权威，限定Desktop/PATH原生发现；真实发现和fresh额度两窗口/来源已观察，未读auth/token或存数值。Tauri invoke仍不可写/不可配置（与本文件G8-A-STATE1既有诊断一致），新计数wrapper没有挂上，reads=0不是没有读取；原计数FAIL与精确次数UNVERIFIED保留。
- Native runner需明确DPI awareness才可将CSS×DPR和GetWindowRect物理坐标比较；此次PS虚拟rect问题已在诊断记录后修正。天气saved状态必须读天气域结果而非旧全局settings状态；首次重启应等WebView监听ready。保留全部工具失败，不通过扩大等待替代产品读回。
- 新installer SHA1711cc7b…a7fd050；前端223/Rust146（4 ignored）、final raw55项、杭州真实天气/保存重启、三启动各7进程正常托盘回收、600 notice payload及交付哈希PASS。未覆盖安装正式应用，E5/原延期项保持；profile/final-profile身份缓存仅按精确规则忽略、不读正文。见[G8-C-F2](evidence/G8-C-F2/result.md)、[交付复核](evidence/G8-C-F2/delivery-verification.json)。

## G8-B-F1 设置入口诊断与fresh候选（2026-10-02）

- 旧“设置动作PASS”只证明发送操作；页面仍是Todo。真实旧包复现＋获批原型核对确认双重问题：UIA模式/PID/前台及读回属于自动化；shell-view拒绝从活动面板开设置属于产品偏离。原型openSettings先关闭活动面板，不能用“先返回摘要”掩盖缺陷。
- 最小修复只改shell-view两行并新增9个导航回归；RED9失败→GREEN17；fresh前端216/Rust138（3 ignored）和NSIS通过。真实安装新SHA五安全模块面板直接开设置、合成草稿不丢、自动保存/重启/同版重装/卸载保留数据、正常托盘显示退出通过；600随包文件和主/安装器Blocks资源匹配，真实托盘可辨。
- 新installer SHA `3977b7340b360f1263eb6d2d2a4512c814f653d65fa92bfa499276dd4526fa12`；实际安装EXE SHA `683d09f460bcdff7d7daa217ed3c5a483088de779d848edde15ca374280d59fe`。唯一UNK→NSS转换核对后才接受安装EXE差异，旧身份/旧性能证据不复用为新SHA通过。
- NSIS卸载器退出码可能先于后台实际清理完成；应在精确身份范围有界等待注册/快捷方式/EXE消失，保留初始未读回失败。此次先恢复原目录再完成独立读回；最终两原目录metadata一致、备份和产品进程/注册/快捷方式为空，原正文未读。保留的仅任务合成数据。
- 19项父复核限定PASS后，哥哥明确答复“接受限制，作为本机自用候选进入 G8-C”；G8-B按该范围completed，G8-C in_progress等实际体验E5。跨版/24h/外部/完整生命周期等仍UNVERIFIED，无公开发布/新增隐私或系统干预授权。见 [result](evidence/G8-B/result.md)、[父复核](evidence/G8-B/settings-fixed-independent-review.json)、[决定](evidence/G8-B/candidate-decision.json)、[清单](evidence/G8-C/acceptance.md)。

## G8-B 原数据恢复补完（2026-10-02）

- 上轮 WinError 17 是将 C 盘目录 rename 到 D 盘证据目录造成的跨盘限制，不是原数据丢失。修正为 C 盘同级保留测试目录，先用 synthetic 数据演练，再真实执行恢复。
- 两个正式目录恢复到原名；独立读回其目录/文件 identity、大小和修改时间均与隔离前元数据一致，备份目录剩余0，本项目进程为空。原库正文未读；未新启动应用或安装。见 [恢复结果](evidence/G8-B/recovery-result.md)、[独立复核](evidence/G8-B/restore-readback.json)。
- 隔离真实数据前，应预演同盘隔离和恢复链路，记录所有精确路径，并预留工具预算先满足恢复硬关卡，不能以“脚本已修”代替真实恢复。本次测试数据仍保留在 C 盘同级 `.g8b-test-data-20261002` 目录，未删除。
- G8-B仍in_progress，设置入口有效读回、跨版本升级及正式发布范围尚未解决；G8-A原未验项与G8-C未启动状态不变。

更新：2026-10-01（UTC；本地读回时间2026-10-02 +08:00）：G8-A按用户明确决定closed_with_unverified；SAFE2五场景限定PASS，用户正常退出后7自有进程/EXE/9244实际回收PASS。原自动FAIL保留、完整验收缺口移延期清单，不把任务收口当全项通过。

## G8-A 用户收口与退出后独立回收

- 用户明确说“已从任务托盘退出，可以关闭G8-A了，同步更新项目文档”。据此关闭本轮任务；任务状态与PERF/LIFE完整验收结果分开，当前完整门槛仍有UNVERIFIED，不重新启动应用或推定新授权。
- fresh OS读回：捕获的7个PID均不存在、复用PID0、精确测试EXE实例0、9244连接0。证据：[退出后独立读回](evidence/G8-A/final-20261001-1814/safe2-20261001-2108/user-tray-exit-retirement.json)。退出动作E5来自用户报告，回收E2来自工具；自动suite/恢复的原失败不改写。
- 旧“仍运行/回收BLOCKED”只描述下方2026-10-01历史时点，当前已解除。完整每模块启停/应用重启、高风险/24h及观测缺口逐项保留：[延期清单](evidence/G8-A/final-20261001-1814/deferred-acceptance.md)。本次仅文档同步，没有产品代码、重建、安装包、发布或全量回归。

## G8-A-SAFE2：手动场景改变确认与可信重测（2026-10-01）

- **2026-10-01 23:08历史阻塞（现已由用户退出/工具回收解除）**：P0/P1/P2/P3/P6已分别有parent-review证据；P6为100完整面板/返回/设置/关闭循环、五安全模块各20、400点击/1200pointer事件，真实采样窗/CSV/磁盘guard通过，258产品源码冻结不变。原suite最后正常退出失败并exit1；首次为Shell tray missing。只读诊断发现WinSta0/Default输入正常，同次旧ClassWindow=0但精确类FindWindow可见Shell_TrayWnd/HWND65880/Explorer6672/session1，不把枚举内部原因或产品退出缺陷当已证实事实。独立任务内helper克隆仅补精确查找并加root start/Explorer/session保护，原helper/公式字节保留；一次恢复止于Overflow target ambiguous，UIA托盘0按钮/0子节点，独立GUI对该确切HWND也拒绝capture，没有退出点击或强杀。该时点fresh read-back同7自有身份、精确EXE和9244仍在，原阻塞证据保留；当前实际回收见上方新记录，不用手动退出冒充自动脚本已修。
- **用户明确事实**：针对旧19:27附近三模块变化，哥哥回复“有，我自己开了这三个icon”。因此旧P0不是空壳场景保持到结束，来源归因为用户主动配置；STATE1取证卡可完成，不因这个确认把旧P0/P1或20:54无输入诊断变成PASS，也不把20:54输入者归因给哥哥。没有产品回写缺陷被确诊，不改产品代码。
- **验收runner补漏**：旧audit只查setup，无法发现中途修改。这轮真实App必须新timeOrigin；精确测试settings bytes/hash/mtime在sampler外≤1Hz观察，静态场景CDP断开但页面被动DOM/input guard保留；P1/P6核验100完整循环与200/400点击完整pointer链，没有额外键盘/未知点击。CPU公式/计数器/预算measure-processes.ps1与原文件完全一致；主动循环从真实warmup=0日志后开始，audit核对各循环时间处于实际采样窗。
- **已验证前置**：14项guard判定E1/15脚本语法PASS；真实设置打开/关闭canary捕获两次完整click与对应DOM转换，P0空模块与guard start PASS。258产品源码freeze全未变，7复制原runner/helper逐字一致，旧诊断JSON/trace/退出hash保持；新EXE只是同SHA受控复制，不冒称新编译或本轮207前端/Rust138复验。
- **实际执行**：新profile/PID10772/端口9244，21:31:57启动P0测量，handle proc_c5ef0075b5f9；P0/P1/P2/P3/P6各120秒稳定+600秒、每场景CSV+guard审计后才继续，P2隐藏Timer恢复、P3真实约2s/single-session/Settings暂停恢复、P1/P6各100完整循环与最终精确退出仍待真实完成。被动guard及磁盘观测开销未独立量化；GPU/wakeups/树外归属/每模块100启停/24h等不外推PASS。高风险授权最后集中处理，不提前启动G8-B/C。见 `evidence/G8-A/final-20261001-1814/safe2-20261001-2108/`。

## G8-A-STATE1：P0采样期间设置改变（2026-10-01）

- **实测/文件证据**：旧PID6212的P0 setup在19:24:37记录磁盘/DOM空列表；精确隔离settings文件mtime为19:27:09.283698，最终enabled=[todo,cpu,gpu]；19:36:41 P1前置读回这三项并FAIL。旧P0的121样本/600秒统计可复算，但独立audit只查前置，没有采样全程场景一致性；因此数值保留，正式场景验收UNVERIFIED，不能继续拿它当空壳P0通过。
- **归因边界**：原源码App只在mount加载设置，Shell持有settings且设置保存/几何回调可写入；native settings_load每次读取文件、save原子写入，无读取时自动保存。原P0 runner在setup后只有测量/audit，不发UI输入。以上不能反推旧写入者；旧运行无输入/IPC来源trace，归因澄清未答复，产品自动补模块、另一脚本或人工输入都未确诊。
- **新诊断**：旧EXE/profile/失败和7进程正常退出证据保留，原258文件freeze全未变。新同SHA隔离PID24136/profile/9243；native invoke descriptor实测writable=false/configurable=false，未强行替换。用CDP Network按settings_load/save精确URL过滤、只存模块ID/调用栈位置/HTTP状态（不存headers/body），加白名单被动DOM/input和精确测试文件hash/mtime；真实UI隐藏CPU canary确认click→settings_save→200→磁盘改变链，9项前置PASS。20:44:47开始实际720.1006408秒/713观察，DOM空模块、磁盘hash/mtime完全不变、0 settings_save；但20:54:30.553–31.097收到pointerdown/up/click及2条keydown，严格无输入FAIL。runner本窗没有输入命令，但trusted不足以判人或其他自动化，不未经确认归咎哥哥。本次没有模块回写也不证明旧19:27写入者；12项11 PASS/1 FAIL、原FAIL保留。
- **当时回收/阻塞**：observer已移除，正常托盘退出及7进程/精确EXE/9243回收通过，再次独立读回捕获PID与端口均为空。258源码freeze仍未变，没有新产品修复/完整E1复跑。20:57时点因旧19:27来源/测试隔离不确定blocked；随后哥哥的三icon确认解除旧来源阻塞，最新SAFE2条目替代当前执行状态，不删除当时FAIL。见本卡result.md和independent-audit.json。
- **限制**：被动诊断有CDP/DOM/文件观测开销，不等同原条件性能PASS；未复现仅NOT_REPRODUCED，不叫已修。输入trusted不能区别CDP和真人；来源判定还需对照runner动作时间和外部操作事实。新profile不读私人Clipboard/凭据/媒体/网络，不先启动24h或新的高风险授权。
- **工具失败保留**：首个后台node入口只返回stdin is not a tty，未执行trace；改用已知明确node.exe后真实canary与诊断启动。首个进程清单命令受跨shell变量/输出编码影响未证明进程状态，随后单引号保护的精确进程清单返回空；没有据此杀进程/重装工具。见 `evidence/G8-A/final-20261001-1814/state1-20261001-2036/`。

## G8-A-DEV1：普通 Vite dev 入口监听范围（2026-10-01）

### 后续连续执行：Timer禁用与错误提示命中（2026-10-01）

- 真实E2发现运行中隐藏Focus会保存成功且Timer仍运行，违反PRD先明确取消或阻止保存的安全门。ShellFrame持久化入口最小阻止running/paused/未知快照的移除，用当前store getter而非闭包旧快照；闲置/完成/其他设置仍可保存，7项handler E1及真实running/paused→UI重置→允许隐藏通过。
- 实际elementFromPoint证明全局纯文字save alert会遮住Focus按钮、pointer-events=auto；只给shell-frame.css该类添加pointer-events:none。旧失败保留，fresh候选11项真实安全门通过，不把产品失败叫harness错误。后续Reset按钮位于真实activity-panel滚动区域，而原runner只滚动settings区域；诊断clientHeight303/scrollHeight419后只修runner容器选择，保留原节奏、从零复测。
- fresh候选SHA9e130dbe…fc8f007/PID6212；36 files/207 tests、Rust138/0/3与构建通过；中性及聚焦memory两例Show同HWND/rect与CSS×DPR读回通过，不覆盖原R1的模式差异失败或推断睡眠/多屏恢复通过。257基线仅ShellFrame、shell-frame.css和两测试文件变化（253不变），新增Timer guard测试；原native源码/权限未变。
- 同版P0/P1/P2/P3/P6安全短测已后台串行启动，当前P0 setup通过、测量进行中。测量证据适配器只扩展标签/文案，逆向修改与原脚本逐字一致，公式、计数器、预算、缺失判断不变。实际结果/时长未提前标PASS，24h/外部模块/Clipboard/断网睡眠授权表单未答复。证据与后台handle见 `evidence/G8-A/final-20261001-1814/progress.md`。

- **实测**：真实默认npm.cmd run dev在ready后仍有fixture/TSX/@vite/client五条请求各5秒超时；只排除src-tauri/target仍失败。诊断watcher登记2255目录/14177 FSEventWrap，大量目录来自app/evidence历史构建输出；稍后请求能成功，不能称永久死锁。
- **源码事实与修复**：optimizeDeps.entries的排除不限制server.watch；只在app/vite.config.ts新增watch ignored evidence与Rust target，保留源码HMR、默认脚本与依赖发现，不清cache/升级依赖。新增dev-watch-config.test.ts使用真实Vite watcher，在合成根中验证源码/fixtures/Rust源码被监听、生成输出不被监听，RED→GREEN。
- **当前结果**：默认新进程首次启动/重启6条HTTP均200，总probe分别1.152/1.175秒；已有缓存保留，另用默认配置--force强制依赖重新优化补充验证（1.198秒、6条200），不把补充命令冒称默认入口。隔离浏览器18+5+17=40项、same-navigation HMR、35 files/199 tests与typecheck/fresh前端build PASS；所有task-owned dev/Edge与1430/9238/9229回收PASS。原始失败和测试端路径/引号诊断保留，未改产品绕过。
- **影响边界**：298源码基线仅vite.config.ts改动、297不变，新增测试另记；fresh dist三个文件与R1 bundle相对路径及SHA一致，未重建原生EXE、未执行Rust或原生性能验收。Show原同rect仍UNVERIFIED；P2/P3本卡未恢复，24h/高风险/G8-B/C不扩大。证据：`evidence/G8-A/dev1-20261001-1650/result.md`、`independent-audit.json`、`source-review.diff`。

## 1. 当前工作区事实

| ID | 事实 | 证据/等级 |
|---|---|---|
| F-001 | 实际目录为D:\wenjian\codex_wenjian\Widget Platform；原始任务文件名为项目评估.md | 本地文件检查/E0 |
| F-002 | 基础文档编写前仅有项目评估、项目调研报告与research目录 | 本轮目录检查/E0 |
| F-003 | Goal 0开始前根目录不是Git仓库；G0-B后根Git已初始化于main分支且尚无commit | G0-A/G0-B原始status与rev-list/E0 |
| F-004 | 本项目应用、产品测试、安装包均尚未建立 | 目录检查/E0 |
| F-005 | 参考Codenotch前端测试8/8及3个页面脚本解析通过 | research/验证记录.md；历史调研E1，非本轮重跑，非本项目证据 |
| F-006 | 调研时未验证Rust编译、真实Desktop资源与硬件；当前环境已由G0-A重新盘点，实测状态见F-007/F-008 | research/验证记录.md、evidence/G0-A/environment.md |
| F-007 | 当前系统为Windows 11家庭版中文版25H2，build 26200.9457，x64；交互桌面可访问，一个活动显示器，150%缩放 | [G0-A环境清单](evidence/G0-A/environment.md)/E0 |
| F-008 | Git 2.54、Node 24.15、npm 11.12、MSVC 19.44.35228、Windows SDK 10.0.26100和WebView2 153.0.4234.48可用；Rust toolchain与.NET SDK缺失 | [G0-A环境清单](evidence/G0-A/environment.md)/E0；本机命令 |
| F-009 | 根Git已初始化main分支，无commit；嵌套Codenotch/Pillar/Zebar副本保持干净并由根忽略，公共研究记录仍可见 | [G0-B工作区记录](evidence/G0-B/workspace.md)/E0 |
| F-010 | 固定研究副本根许可证：Codenotch MIT、Pillar MIT、Zebar GPL-3.0；没有复制或修改研究源码 | [G0-B工作区记录](evidence/G0-B/workspace.md)/E0 |

## 2. 调研结论的使用边界

源码固定提交：
- Codenotch：aae2c1f77bd2f2fb6c03aa58ca6329c5d003fab4。
- Zebar：40caceceee84aa7fbaf7eddecf6e80ba149364ec。
- Pillar：4017de9ee1c83d156952771a9f685175bbb27e9f。

代码细节与官方来源见《项目调研报告.md》。本轮没有重新拉取上游，固定提交事实不表明上游最新版本仍相同。

重要结论：Windows Codenotch前端/DTO高度面向quota；有50ms鼠标watchdog；Codex额度与活动是不同数据路径；活动缓存时效风险需重新设计；默认源码updater公钥占位。均属于参考项目E0，不是本项目缺陷或已经修复事项。

Zebar可作为直接使用对照，但复制GPL代码与运行平台是不同选择。视频产品身份未确认，不作为架构依据。

## 3. 当前决策记录

| ID | 决策 | 状态 | 理由 |
|---|---|---|---|
| D-001 | 建立8份基础文档 | 用户授权、已编写 | 便于Luna接手 |
| D-002 | 开发按Goal，不按周或天 | 用户明确要求 | 最新指令优先于调研历史时间表 |
| D-003 | 先G0环境→G1路线，不能直接开始全部功能 | 工作计划 | 未取得真实宿主证据 |
| D-004 | 一张卡一个有界变更，明确路径/验证/停止条件 | 工作计划 | 降低执行器的跨模块推导负担 |
| D-005 | Route B + Tauri为候选，不是通过结论 | 待G1 | 保留Zebar/WPF对照 |
| D-006 | 暂不插件SDK/Event Bus/云同步 | 当前范围 | YAGNI，样本需求不等于平台生态 |
| D-007 | 首版候选本地Todo/Timer/CPU-RAM，其他独立增量 | 待发布范围收口 | 不将所有样本压进首次交付 |
| D-008 | 初始空闲预算CPU≤0.2%、private WS≤150MiB | 工作假设，待实测/取舍 | 明确测量口径，禁止自行上调过关 |
| D-009 | 初始化产品根Git main分支；研究源码目录显式忽略；不自动stage/commit/push | G0-B已执行，工作区未提交 | 保留嵌套仓库边界与后续可审查性 |
| D-010 | G1-A 证明 Zebar 可承载小摘要、独立输入窗口和基础开关；任意排序有差距。未作 Zebar/Tauri/WPF 宿主选择 | 待 G1-E | 继续比较 G1-B/C/D，不能仅凭 G1-A 选路线 |
| D-011 | G1-C 仅授予 Tauri 几何所需的 monitor 查询、位置、inner/outer size 和 event listen/unlisten 命令 | G1-C 已执行 | 不启用整个 Tauri default capability；UI 更新由显式操作和窗口事件触发 |
| D-012 | G1-E 选择 Tauri 2 + Rust + TypeScript 为 G2 独立产品候选；WPF 留作原生对照，Zebar 不直接采用 | G1-E 已记录 | Tauri 满足本轮 P0工作预算和主要单屏交互需求；混合 DPI、恢复及最终哈希完整交互复验仍未关闭，不代表用户验收 |

## 4. 风险登记

| ID | 风险 | 关闭任务 | 当前状态 |
|---|---|---|---|
| R-001 | 工具/真实Desktop条件不明 | G0-A | 盘点已完成；路线缺口与E2未验证范围见G0-A证据 |
| R-002 | 透明命中、IME、多屏DPI | G1-B/C/D | G1-C 单屏几何/IME子项及G1-D四边、50次点击、IME事件、双屏混合DPI往返子项通过；托盘、IME文本/选区替换和SHELL-04恢复未验证 |
| R-003 | WebView / 原生空闲资源 | G1-B/D/E、G8-A | G1-B完整P0 counter与整体门槛仍缺；G1-D WPF/Tauri P0/P1已采，P1有进程/显示器条件差异；GPU/唤醒及共享树外WebView未测，不能做完整路线结论 |
| R-004 | 外部Codex Desktop任务可观察性 | G5-C | UNVERIFIED |
| R-005 | Hermes模式/版本hook覆盖 | G5-C | UNVERIFIED |
| R-006 | 数据写失败/重启恢复 | G2-B、G3 | UNVERIFIED |
| R-007 | Clipboard误收隐私与恢复循环 | G6-B/C | G6-B 领域合同与安全 E1 已关闭；真实 listener、持久化、恢复写回与释放仍由 G6-C 验证，功能默认关闭 |
| R-008 | GPU 跨厂商/混合显卡支持范围 | G7 | 当前 NVIDIA RTX 4060 已验证；其他厂商、混合显卡和远程桌面未验证；硬件温度已移出当前产品范围 |
| R-009 | 参考代码许可、identity/updater混用 | G1-E、G2-A、G8-B | 待实现时检查 |
| R-010 | 把研究测试/模拟结果当产品验收 | 每张任务卡结束 | 文档已设约束，持续执行 |
| R-011 | G2-UI-A 初始 Edge/CDP 矩阵从错误节点读取布局状态，首轮未产出几何证据 | G2-UI-A | 已闭环：selector 修正后补齐 dock 状态属性和纵向 grid，最终 72/72 E1 PASS 并完成截图对照；Windows/Tauri DPI 仍 UNVERIFIED，作为真实窗口验证边界跟踪 |
| R-012 | G2-UI-B 真实窗口悬停/拖动输入与 UIA 状态读取不稳定 | G2-UI-B | 窗口内悬停、面板/Esc、设置和隐藏提示 E2 仍有效；UIA 底边偏差 168 px 已记录。此前四边交互没有移动 OS 窗口，原生宿主与贴边证据仍待补。多屏/混合 DPI/恢复也仍 UNVERIFIED |
| R-013 | G2-A 托盘 Show/Exit 缺少可安全调用的桌面 UIA 目标 | G2-A | 已由 F-047 关闭：打开独立 overflow XAML 窗口后，精确产品 `SystemTray.NormalButton` 与两个菜单项均提供 InvokePattern；未发送坐标输入 |
| R-014 | G2-UI-B 原生宿主被实现成普通大窗口；React 四边拖动未移动 OS 窗口 | G2-UI-B | 已确认并更正状态；当前实现无原生无边框挂件和桌面贴边证据，修正与 E2 复验进行中 |

## 5. Goal 1 / G1-A 新发现

| ID | 事实 | 证据 / 等级 |
|---|---|---|
| F-011 | 本机初始没有 Zebar 安装；G1-A 使用官方 v3.3.1 Windows x64 MSI 的管理员映像提取，在 prototypes/zebar/.runtime 内隔离运行；MSI SHA 与官方发布值一致，签名有效。 | [G1-A runtime probe](evidence/G1-A/runtime-probe.txt) / E0、E2 |
| F-012 | Zebar v3.3.1 的 WidgetConfig 支持 focused、transparent、zOrder 与 presets；client API 可按预设启动 widget 并关闭当前窗口。真实运行中两个独立窗口可通过点击打开、Esc/按钮关闭、CLI 重开。 | [G1-A interaction test](evidence/G1-A/interaction-test.md) / E0、E2 |
| F-013 | Zebar 的 zOrder 是窗口前后层级，presets 配置位置和尺寸；未发现任意模块顺序字段或拖动排序设置界面。需要产品级可编辑顺序时应在本项目实现顺序模型、设置 UI 和保存/恢复，不应把 zOrder 当成顺序能力。 | G1-A 静态检查 `WidgetConfigForm.tsx`、`WidgetConfig`、zpack schema / E0 |
| F-014 | G1-A prototype CPU 摘要固定显示 23% 合成样例；真实 CPU provider、性能和持续采样均未测。 | [G1-A result](evidence/G1-A/result.md) / E2；数据本身为合成值 |
| F-015 | G1-B 两次 600 秒 P0 CPU 序列完整并低于工作阈值；私有工作集和 Private Bytes 各有计数器样本缺失，overall PERF-01 为 UNVERIFIED。脚本末次切换到按 PID 构造计数器路径后只做了 parser 检查，未进行第三次完整 E3 测量。 | [G1-B result](evidence/G1-B/result.md)、两轮 p0 summary.json / E3 部分 |
| F-016 | 固定 Tauri API 返回 monitor 的物理 work area、物理 position/size 和 scaleFactor；G1-C 原型用 inner/outer size 差值补偿外框，使停靠坐标按物理外框计算。 | [G1-C runtime probe](evidence/G1-C/runtime-probe.txt)、[官方 Monitor API](https://docs.rs/tauri/2.11.5/tauri/window/struct.Monitor.html) / E0、E2 |
| F-017 | G1-C 在本机单个 DISPLAY1、150% 缩放和 2560×1528 工作区下，真实 release 四边和 ratio 两端均在工作区内；负坐标实体显示器、混合 DPI、热插拔和恢复条件没有通过。 | [G1-C desktop results](evidence/G1-C/desktop-results.json)、[G1-C result](evidence/G1-C/result.md) / E1、E2；E4 UNVERIFIED |
| F-018 | G1-C 真实中文键盘布局 0x8040804 下，Pinyin 键序能提交中文；全选替换、Tab、Esc 和重开草稿保留通过。一次早期按键批次在 Codex 窗口前台时执行且未按 Enter；可能影响未发送草稿，未读取或修复。后续所有按键批次均验证原型前台 PID。 | [G1-C interaction test](evidence/G1-C/interaction-test.md) / E2 与操作事故记录 |
| F-019 | G1-D 在项目级 .NET SDK 10.0.401 下构建为 Release，5 项几何/DPI 测试通过；真实启动使用 PerMonitorV2 awareness，当前主屏为 96 DPI，摘要窗 292×72。仅证启动不抢前台及一次实际打开面板，不代表托盘或完整输入通过。 | [G1-D result](evidence/G1-D/result.md)、[launch probe](evidence/G1-D/launch-probe.json) / E1、E2 部分 |
| F-020 | G1-D 一次 IME 输入测试在自有临时 TextBox 产生未预期长联想；前台 PID 检查确认按键发往 WPF 测试进程，未按 Enter。随后清空该输入框，并把含文本日志改写为脱敏记录；IME 与 SHELL-03 保持 UNVERIFIED。后续因物理命中目标落到测试进程外而停止点击。 | [G1-D result](evidence/G1-D/result.md)、[redacted desktop record](evidence/G1-D/desktop-test.json) / E2 事故与限制 |

F-019/F-020 描述的是较早时点证据；当前 Release 的新增测试和边界见 F-021 至 F-029，不覆盖当时的安全处置记录。

| ID | 事实 | 证据/等级 |
|---|---|---|
| F-021 | G1-D 在96 DPI主屏与144 DPI副屏之间切换时，第一轮回切曾按旧 DPI 定位。当前候选在屏幕选择后立即并于 UI 空闲优先级再定位；真实双屏 UIA 往返现已通过，两屏工作区内停靠位置及面板状态恢复。 | [WPF DPI transition source](prototypes/wpf-shell/WpfShell/MainWindow.xaml.cs)、[multidisplay UIA test](evidence/G1-D/multidisplay-uia-test.json) / E0、E2 |
| F-022 | 当前 WPF Release 候选通过单实例子项、50次实体鼠标开合、Tab/Esc、合成草稿保留、主屏四边/比例端点和96↔144 DPI双屏往返。中文 IME 键序观察到 composition start/update/commit 事件，但字段文本未读取或记录；实际结果展示和选区替换仍未验证。 | [desktop interaction](evidence/G1-D/desktop-test.json)、[IME event test](evidence/G1-D/ime-event-test.json)、[single instance](evidence/G1-D/single-instance-test.json)、[multidisplay UIA](evidence/G1-D/multidisplay-uia-test.json) / E2 |
| F-023 | WPF Release P0 完成120秒预热和600秒采样，121个样本；CPU/Private WS门槛通过，内存counter 121/121有效。私有工作集均值52.39MiB、峰值54.88MiB；CPU均值0.0414%、P95 0.1095%、峰值0.3910%。 | [WPF P0 summary](evidence/G1-D/perf-wpf-p0/20260923T124752Z-pid28048/summary.json) / E3 |
| F-024 | 当前托盘探测因前台 PID 不是 WPF 而在快捷键前终止，`inputSent=false`，未点托盘项。托盘 Show/Exit 与退出后残留进程仍未验证；用户随后打开的是 Tauri 空面板，这不构成 WPF 前台门禁通过。 | [tray navigation probe](evidence/G1-D/tray-navigation-probe.json) / E2 UNVERIFIED |
| F-025 | Tauri G1-C最终Release P0完成120秒预热和600秒采样，121样本；CPU和内存counter完整、无错误，CPU与Private WS门槛通过。CPU均值0.0241%，P95 0.0469%，峰值0.8592%；Private WS均值83.38MiB、峰值85.64MiB，Private Bytes均值163.22MiB；进程树含6个WebView2后代。 | [Tauri P0 summary](evidence/G1-D/perf-tauri-p0/20260923T131354Z-pid8660/summary.json) / E3 |
| F-026 | 同脚本P0对照中，Tauri CPU均值比WPF低0.0173个百分点，Private WS均值高30.99MiB。每路线各一次静态摘要样本，不等同于完整路线效率结论；共享树外WebView、GPU和唤醒仍缺。 | [G1-D result](evidence/G1-D/result.md)、两份P0 summary / E3 |
| F-027 | G1-D启动探测最初仍期望G1-B旧SHA；当前磁盘文件的D3AFF...C393哈希与G1-C runtime-probe及final-release-smoke一致，来源是G1-C最终Release重建。探测改为校验该固定最终候选后启动通过。Tauri精确主窗的UIA树能找到Open按钮，但它不支持InvokePattern；用户前置窗口并手动打开空面板，之后只读验证376×359窗口及Close input panel控件通过，未读写草稿。 | [hash mismatch record](evidence/G1-D/tauri-launch-probe-hash-mismatch.txt)、[UIA block record](evidence/G1-D/tauri-open-panel-uia-block.txt)、[panel verification](evidence/G1-D/verify-tauri-input-panel.json) / E2 |
| F-028 | WPF与Tauri空面板P1均完成120秒预热、600秒、121样本，CPU与内存计数完整。Tauri P1与其P0为同一PID；WPF P1使用新PID，且WPF启动记录显示活动显示器从P0时2台变成P1时1台；Tauri未记录显示器数量。测得Tauri P1 Private WS均值86.72MiB、WPF 36.76MiB，但差值只作当前样本观察。 | [Tauri P1 summary](evidence/G1-D/perf-tauri-p1/20260923T134148Z-pid8660/summary.json)、[WPF P1 summary](evidence/G1-D/perf-wpf-p1/20260923T135657Z-pid30272/summary.json)、[WPF launch probe](evidence/G1-D/launch-probe.json) / E3 |
| F-029 | 依据G1-E决策规则选择Tauri作为G2候选：Zebar缺少现成模块顺序持久化，Tauri最终候选P0门槛及主要单屏窗口/输入证据满足当前门槛。混合DPI、恢复和最终哈希完整交互复验仍未通过；G1-B历史P0和G1-D WPF状态仍保留各自UNVERIFIED。 | [G1-E decision](evidence/G1-E/decision.md)、[architecture](架构说明.md) / E2、E3综合判断 |
| F-030 | 参考视频呈现常驻窄栏、悬停概况、点击后活动面板三个交互层级；Clipboard 画面在约 7.8 秒展开，约 10.7 秒调整卡片顺序，约 12.4 秒返回窄栏。它是视觉参考，不证明本项目的原生窗口、数据来源或隐私行为。 | [UI-D1 result](evidence/UI-D1/result.md)、`参考产品UI UX/ui演示.mp4` / E0 |
| F-031 | UI-D1 保留顶部默认摘要和四边停靠，增加右侧紧凑布局、只读悬停概况、单个向内展开活动面板及沿边设置。独立 Edge 153 浏览器检查覆盖 1440×1000 与 390×760、四边边界、待办操作、计时收起后继续、Esc 返回；只算 HTML 原型 E1，真实 Tauri/托盘/DPI/恢复仍未验证。 | [UI-D1 browser result](evidence/UI-D1/browser-result.json)、[UI-D1 result](evidence/UI-D1/result.md) / E1 |
| F-032 | 用户评阅后明确拖放契约：四边虚线目标内居中，目标外按释放坐标贴最近边缘；摘要仅保留图标，数据仍留在可访问名称、悬停概况和活动面板；显示只有常显与原边原位置提示条两种模式。原型拖动时释放事件可能不落在手柄上，需由窗口层结束拖动。 | [UI-D1 revision browser result](evidence/UI-D1/revision-browser-result.json)、[UI-D1 result](evidence/UI-D1/result.md) / E1 |
| F-033 | 沿边位置只按卡片本体宽高限制仍可能让突出的移动手柄被父容器裁掉。停靠约束应计入卡片两端控件的外伸尺寸；已保存的旧偏移也必须在加载和窗口缩放时重新约束。UI-D1 在 920px 五图标和 390px 五图标浏览器视口完成手柄可见、可拖回和无水平滚动检查。 | [UI-D1 revision browser result](evidence/UI-D1/revision-browser-result.json)、[920px 靠左截图](evidence/UI-D1/revision-920-left-limit.png) / E1 |
| F-034 | UI-D1 旧布局把五模块卡片最小长度抬到约 354px，圆形图标又随卡片厚度和槽位缩小。评阅修订改为独立图标直径、基于图标数量/点击区域/间距/圆环的卡片下限；默认 46px 图标下三模块可达 176×68px、五模块 284×68px，390px 窄屏保持图标大小并换行。旧预设迁移与自定义偏好安全约束仅在 HTML 原型 E1 验证。 | [UI-D1 sizing result](evidence/UI-D1/sizing-browser-result.json)、[UI-D1 result](evidence/UI-D1/result.md) / E1 |
| F-035 | 用户确认一级图标是各模块共用的状态与快捷操作位，而非固定标志。UI-D1 以同一显示契约演示待办完成数交替、专注倒计时/结束铃铛、CPU/GPU/内存圆环、媒体播放状态和天气高低温；待办顺序在原型 localStorage 保存。真实鼠标排序使用指针事件后通过，原生 HTML 拖放在独立浏览器中未触发 `dragstart`。系统和天气数值只是明确标识的演示数据，不证明传感器、媒体或天气接入。硬件温度演示已不属于当前产品范围。 | [UI-D1 dynamic result](evidence/UI-D1/dynamic-browser-result.json)、[UI-D1 result](evidence/UI-D1/result.md) / E1 |
| F-036 | 用户进一步明确 F-035 中 CPU/GPU/内存的归属：三项必须各有独立一级图标、圆环、悬停概况、面板和模块设置，不能在一个“系统”入口内轮换。旧 `system` 已保存顺序按原位置展开为三项；390px 下当前模块布局需保持图标不重叠/越界。指标仍为示例数据，原生采样未验证。硬件温度模块已从当前产品契约移除。 | [UI-D1 dynamic result](evidence/UI-D1/dynamic-browser-result.json)、[UI-D1 result](evidence/UI-D1/result.md) / E1 |
| F-037 | UI-D1 旧尺寸模型分别保存横向宽/高与纵向长度/厚度，切换边缘时即使图标大小相同，卡片厚度也会跳变。修订后四边共用长边/厚度，纵向仅旋转几何；旧设置以加载时当前停靠方向的尺寸迁移，四边偏移仍独立。920×897 八图标、长边 580px、厚度 90px 的浏览器检查覆盖四向旋转、图标边界和持久化；受预览区域限制时仍可能自动换行。 | [UI-D1 sizing result](evidence/UI-D1/sizing-browser-result.json)、[顶部截图](evidence/UI-D1/sizing-shared-top.png)、[右侧截图](evidence/UI-D1/sizing-shared-right.png) / E1 |
| F-038 | 用户于 2026-09-24 批准 UI-D1 v2 原型作为后续 UI/UX 的严格基线，设计评阅阶段结束。原短计划的“尚无获批视觉稿”与“待办不引入拖拽”已被用户后续决定替代；现有 Goal 2 增加分开的 UI 基础任务而不改变 Goal 编号，Goal 3 的待办任务补上拖动与键盘排序。HTML 设计获批不代表真实 Tauri 产品或外部数据已验收。 | [UI-D1 approval record](evidence/UI-D1/result.md)、[current plan](开发短计划.md)、[asset metadata](designs/widget-platform-reference-preview/_d_meta.json) / 用户设计决策、E0 |

## 7. Goal 2 / G2-UI-A

| ID | 事实 | 证据 / 等级 |
|---|---|---|
| F-039 | G2-UI-A 已从获批 UI-D1 v2 提取颜色、字体、卡片圆角和图标槽位，实现四边共用长边/厚度与安全换行；产品默认六图标不含进度值，八图标及合成环值只在隔离 fixture。类型检查、7/7 单测和生产构建通过。初始 Edge 轮次从 `.shell-dock` 读取只存在于 `.shell-stage` 的状态，导致 readiness/几何未通过；修正后 Edge 153 的 72/72 E1 几何和截图对照通过。1× CSS 像素不证明 Windows/Tauri DPI。 | [G2-UI-A result](evidence/G2-UI-A/result.md)、[browser attempts](evidence/G2-UI-A/browser-layout-attempts.md)、[screenshot comparison](evidence/G2-UI-A/screenshot-comparison.md) / E0、E1 |
| F-040 | 四边矩阵测得桌面卡片共用 580×90 长边/厚度，右/左为 90×580；移动端 52px 图标在 355×650 stage 内两列四行，34px 图标侧栏单列完整显示。矩阵发现 dock 缺少 CSS 状态属性、纵向 grid 未旋转；修正后 72 项全部通过，无重叠、越界、运行时异常或 console error。 | [browser geometry result](evidence/G2-UI-A/browser-layout-result.json)、[desktop and mobile screenshots](evidence/G2-UI-A/screenshot-comparison.md) / E1 |
| F-041 | 历史 E1 fixture 8/8 通过；旧真实 Release E2 的悬停、活动面板/Esc、设置和隐藏交互也通过，但 SHA-256 `376F9D69E2DEB45D6ED67E8F1593354E200BC74D1EFAA47A45781C2727EF63E0` 仍是居中 820×520 大窗口，四边拖动只改变 CSS。该证据不验证桌面停靠；后续原生挂件验证见 F-045。 | [G2-UI-B E1 result](evidence/G2-UI-B/browser-interaction-result.json)、[corrected E2 result](evidence/G2-UI-B/result.md)、[current Release rect](evidence/G2-A/current-release-shell-e2/native-interaction-result.json) / 历史 E1、E2 |
| F-042 | 旧 E2 UIA 在 CSS dock 位于底边时返回的矩形相对截图水平偏移 168 px；此差异仅影响窗口内元素探针定位。因 OS 窗口本身没有移动到屏幕边缘，旧截图只能说明 dock 在 WebView 客户区的位置，不能说明桌面坐标或原生外框位置。 | [G2-UI-B native result](evidence/G2-UI-B/native-interaction-result.json)、[corrected screenshot review](evidence/G2-UI-B/native-screenshot-review.md) / E2 |
| F-043 | G2-A 新 Release `DBE52A653A9D5AC7B1CE5B633525B2018330EDD6E916E083107DECEA35574648` 构建成功；真实窗口交互 10 项、生命周期单实例/关窗隐藏/二次启动恢复/无精确进程残留均 PASS。加上 stable tray id 和 tooltip 后，限定在 Shell tray UIA 树与产品精确名称仍未发现产品图标；隐藏图标按钮 Invoke 已调用，但 popup 状态未确认且可枚举树没有精确 tray 图标。普通分组任务栏按钮缺少 InvokePattern，不作为托盘菜单替代。 | [G2-A Release build](evidence/G2-A/tauri-tray-tooltip-release-build-retry.log)、[current Release shell E2](evidence/G2-A/current-release-shell-e2/native-interaction-result.json)、[lifecycle](evidence/G2-A/native-lifecycle-final-release.json)、[tray UIA discovery](evidence/G2-A/tray-uia-tooltip-discovery.json) / E2 |
| F-044 | G2-A 当前 Release 配置的主窗是 820×520 客户区、`decorations=true`、`transparent=false`、`alwaysOnTop=false`、居中启动。G2-UI-B E2 拖动后 `GetWindowRect` 始终为 `x=862,y=420,width=836,height=559`；变化的是客户区中的 CSS dock。这是此前把普通 desktop 窗口误判为桌面挂件的直接证据。 | [Tauri window config](app/src-tauri/tauri.conf.json)、[native interaction result](evidence/G2-A/current-release-shell-e2/native-interaction-result.json) / E0、E2 |
| F-045 | 2026-09-25 修正后的 Release `63DAFE33A1E34C7ED5481F732CFB31631183855F8C31117CB51CFE1B5124EAC1` 已作为真实小挂件通过 E2 16/16：启动 320×124 不抢焦点；无可见非客户区标题栏、置顶；四边 OS 外框与 2560×1392 工作区均 0px 对齐；概况/面板/设置扩窗，隐藏/恢复尺寸正确；精确 Release 进程清理通过。证据仅覆盖单显示器 96 DPI；当时 G2-A 托盘尚待复验，后由 F-047 补齐。 | [native E2 result](evidence/G2-UI-B/native-widget-host-e2/native-widget-host-result.json)、[screenshot review](evidence/G2-UI-B/native-screenshot-review.md) / E2 |
| F-046 | 原生悬停状态更新时，模块失焦若同步收窗会在设置按钮 `click` 前改变命中区域；把失焦延迟到 native cursor 重新判定并保留挂件内部目标后，E2 设置入口/换边/关闭通过。悬停卡按批准的 UI-D1 v2 收到 286px，避免遮住侧边控制。 | [ShellFrame](app/src/shell/ShellFrame.tsx)、[native E2 click trace](evidence/G2-UI-B/native-widget-host-e2/native-widget-host-result.json)、[approved UI-D1 v2](designs/widget-platform-reference-preview/Widget%20Platform%20UI%20Preview%20v2.html) / 源码事实、E2 |
| F-047 | G2-A 当前 Release SHA `63DAFE33A1E34C7ED5481F732CFB31631183855F8C31117CB51CFE1B5124EAC1` 的 tray E2 全链通过。通过 UIA 展开 `TopLevelWindowForOverflowXamlIsland` 后找到产品 `Widget Platform` `SystemTray.NormalButton` 与 `显示主窗口` / `退出 Widget Platform` 两个可 Invoke 菜单项；Show 恢复 320×124 原位置并取得前台，Exit 结束精确 Release，随后路径扫描无残留。启动未抢焦点、关窗隐藏亦通过。证据为 tray E2 runner/result/log/exit code；范围是单显示器 96 DPI。 | [tray E2 result](evidence/G2-A/tray-menu-uia-e2-result.json)、[probe](evidence/G2-A/tray-menu-uia-e2-probe.ps1) / E2 |
| F-048 | G2-B1 建立 version 1 的 app settings schema 和六个现有 shell ContentId 注册表；范围包含 enabled/order、edge/offset、长边/厚度、图标直径及 `always/hidden`。Rust store 使用可注入目录、校验后同目录临时文件替换；替换失败保留旧配置，坏 JSON 保留原件并创建诊断副本。Windows data location 由 Tauri `app_local_data_dir` 提供；B1 的 Rust 8/8、TS 24/24、typecheck 均通过，Release/E2 持久化仍待 G2-B2。 | [settings store](app/src-tauri/src/host/settings.rs)、[settings model](app/src/settings/settings-model.ts)、[B1 evidence](evidence/G2-B/) / E0、E1 |
| F-049 | B2 Release `01C79A7D…A08AC270` 以 320×166 紧凑挂件启动，设置页在同一原生挂件宿主中扩展为 440×520，几何/E2 通过；首次真实设置保存报 `CrossesDevices`/17。精确 app-local 目录带 EFS 加密属性。Rust rename、Win32 rename/句柄 rename 均失败；`MOVEFILE_COPY_ALLOWED` 可成功但 file ID 表明是复制路径，因此未用于替换。`ReplaceFileW` 在目标目录返回 5/1175，旧内容保留。原 settings.json 测试前后均不存在，精确 Release 进程已退出；保存重启及锁定文件故障矩阵未跑完。为了保留用户现有 EFS 保护，尚未切换到非 EFS 存储。 | [E2 result](evidence/G2-B/b2-e2-persistence-result.json)、[failure screenshot](evidence/G2-B/b2-e2-persistence-failure.png)、[rename matrix](evidence/G2-B/b2-appdata-handle-rename-diagnostic.json)、[ReplaceFile matrix](evidence/G2-B/b2-appdata-replacefile-backup-diagnostic.json)、[copy identity](evidence/G2-B/b2-appdata-win32-file-identity.json) / E2 实测 |
| F-050 | 用户于 2026-09-25 明确授权设置改用非 EFS 本机目录。`AppData`、`Local`、`LocalLow` 均带 EFS；profile 根 `USERPROFILE` 未带 EFS。设置现位于 `%USERPROFILE%\.widget-platform\<bundle identifier>`；应用在解析后创建目录并拒绝 EFS 属性，路径测试可注入。精确 Release SHA `A9EE73282946BC52AD0E9A5595059DB7322E6A9983C1A1B693621AFCB1A7A24A` 的 E2 13/13：首次保存、配置/窗口重启一致、隐藏条重启及恢复、独占文件锁写失败时旧 SHA 不变且可访问错误提示出现。测试配置因原先不存在而仅将精确文件移入回收站；目录与证据保留，进程清理通过。该 override 仅用于 shell 偏好，不改变后续用户内容数据库的路径契约；替代此前 F-049 的阻塞状态。 | [final E2](evidence/G2-B/retry-non-efs/b2-e2-persistence-result.json)、[path cleanup](evidence/G2-B/retry-non-efs/settings-cleanup-result.json)、[Rust rename probe](evidence/G2-B/b2-non-efs-rename-probe-result.json)、[task plan](task_plan.md) / E0、E1、E2 |
| F-051 | G2-C 将事件 store 限定为领域型 snapshot contract：先 listen 后 snapshot，同步时有界保留最新候选，快照确认 instanceId，之后只接受当前 instance 的严格递增 revision；连接 generation 阻止旧连接响应覆盖新连接。Rust counter 用 Condvar 取消等待并在 disable 前 join，Rust 100 轮实测 worker 数每轮归零。Release-profile Tauri E2 8/8；验收 UI/commands 由无依赖 `g2c-probe` feature 提供，最终无 feature/no env Release 不含 probe 路由或 IPC 符号。最终 SHA `2539180926321D6A930528C07379356B1D52C9A811D9840FE18BB3DC87FC8FCF` tray Show/Exit E2 通过，恢复矩形 320×166，退出精确进程；最终 Release 仍未以静态 frontend 做 counter E2。 | [G2-C E2](evidence/G2-C/native-ipc-lifecycle-e2-result.json)、[final build audit](evidence/G2-C/release-audit.json)、[final Release tray regression](evidence/G2-C/final-release-tray-regression.json)、[tests](evidence/G2-C/) / 源码事实、E1、Release-profile E2 |

| F-052 | G3-A Todo backend 已建立 SQLite version 1 schema（items/actions/meta），所有 mutation 使用 Immediate transaction；actionId 由唯一表实现幂等，事务成功后才增加 revision 并生成快照。23 项 Rust 单测覆盖添加/重开、完成/删除、排序/重开、空文本与 2000 字符上限、迁移回滚、拒写保留旧状态和重复 action。Rust fmt、测试和 release check 均通过。E2 真实面板、鼠标拖动和键盘排序尚未验证，留给 G3-B。 | [G3-A result](evidence/G3-A/result.md)、[cargo-test-final.log](evidence/G3-A/cargo-test-final.log)、[cargo-check-release-final.log](evidence/G3-A/cargo-check-release-final.log) / E1 |

| F-053 | G3-B 接入 Todo 前端 snapshot store 和真实 Tauri 面板。UI draft 与后台 snapshot 分离，先 listen 后 snapshot，严格按 instanceId/revision 接受事件；添加、完成/取消完成、删除和完整排序均携带 actionId。后续 Release E2 已确认真实原生鼠标拖动与重启保序，并以独占 SQLite 锁验证拒写提示、草稿保留、旧快照保留和解锁后单次重试。 | [G3-B result](evidence/G3-B/result.md)、[drag E2](evidence/G3-B/todo-drag-sendinput-20260925-133626-787.json)、[refused-write E2](evidence/G3-B/todo-refused-write-20260925-141941-157.json) / E1、E2 |

| F-054 | G3-C Timer backend 建立独立 SQLite version 1 schema（timer_state/timer_actions），后端权威状态包含 Focus/Break、Idle/Running/Paused/Completed、duration/remaining/deadline、generation、completionId、revision 与 clock anomaly。Start/Pause/Resume/Reset/Expire 均以 Immediate transaction 写入，actionId 幂等；暂停保存 remaining，运行中保存 deadline，重启恢复；旧 generation 到期事件不能结束新任务，睡眠跨 deadline 只结束当前阶段，回拨时钟保留最近可信 remaining 并标记 anomaly，回拨后 Pause/Resume 不放大 remaining。注入 clock 的 10 项 Timer 测试及全量 Rust 33 项测试通过，release cargo check 通过。后续真实 Release E2/E3 已补齐面板、S3 睡眠跨 deadline、completionId 单次持久化和重启保持。 | [G3-C result](evidence/G3-C/result.md)、[timer tests](app/src-tauri/src/features/timer/tests.rs)、[timer sleep E2/E3](evidence/G3-D/timer-sleep-e2-20260925-143734-323.json) / E1、E2、E3 |

| F-055 | G3-D 将 Timer snapshot 常驻接入 Shell；面板可 Start/Pause/Resume/Reset，前端可见时按 backend deadline 本地显示秒数，关闭面板/隐藏挂件后 backend 继续运行，重新展开先取权威 snapshot；完成状态显示可访问反馈，只有已有系统 Notification 权限为 granted 时才尝试普通通知，权限不可用不影响完成事实。前端 typecheck、43/43 Vitest、生产构建通过；精确 Release 真实 UIA 9/9 通过，后续独立 Release 真实 S3 睡眠 E2/E3 通过，跨 deadline 只完成 Focus 一阶段且重启不重复。多显示器/DPI、RDP、系统通知拒绝和 E5 用户验收仍未验证。 | [G3-D result](evidence/G3-D/result.md)、[timer-e2-result.json](evidence/G3-D/timer-e2-result.json)、[timer sleep E2/E3](evidence/G3-D/timer-sleep-e2-20260925-143734-323.json)、[TimerPanel.tsx](app/src/features/timer/TimerPanel.tsx) / E1、E2、E3 |

| F-056 | 2026-09-25 G3 复核：早期 Todo 鼠标探针只报告顺序未变，未证明输入送达，保留为历史 UNVERIFIED。随后使用隔离 Bundle ID 和中间行手柄的真实 Release E2，确认 UIA 命中实际按钮、应用进入“正在调整”、连续原生移动/释放、顺序变更及重启保序；TODO-03 鼠标 E2 现为 PASS。独占 SQLite 锁的真实拒写 UI 与解锁后一次重试也已 PASS。Timer 随后的真实 S3 睡眠 E2/E3 通过，G3-B/D 已完成，Goal 3 必需任务完成；多显示器/DPI、RDP、通知权限拒绝和 E5 仍按范围保持未验证。 | [successful drag](evidence/G3-B/todo-drag-sendinput-20260925-133626-787.json)、[refused write](evidence/G3-B/todo-refused-write-20260925-141941-157.json)、[timer sleep](evidence/G3-D/timer-sleep-e2-20260925-143734-323.json)、[task plan](task_plan.md) / E2、E3 |
| F-057 | G3-B 旧 gap probe 在启动时会递归重置 `evidence/G3-B/gap-profile`。本轮复跑替换了此前 task-local 测试 profile；未检查其中内容。后续不得复用该清理行为覆盖既有证据；需要运行时使用新的隔离 profile 路径并保留旧目录。 | [continuation review](evidence/G3-B/continuation-review.md)、[probe script](evidence/G3-B/todo-e2-gap-probe.ps1) / runner 源码事实与本轮操作 |
| F-058 | G4-A 建立只读 GSMTC monitor：MTA 专属 worker，回调经有界队列唤醒，session manager/session tokens 在 session 移除和 stop 时释放。会话 ID 仅对单个 monitor 生命周期稳定；快照、文本和播放状态仅驻内存。Artwork 使用独立不透明引用，按需读取并限制到 3 MiB；WinRT async 请求有 4 秒截止和取消检查。E1 的 38 项 Rust 测试与 Release check 通过；真实播放器的切换/暂停/关闭、错误和封面行为未在无授权测试源时验证，G4-A 尚未完成。 | [G4-A result](evidence/G4-A/result.md)、[attempts](evidence/G4-A/attempts.md) / E1 PASS，E2/E4 UNVERIFIED |
| F-059 | G4-C1 固定系统指标口径：CPU 使用 `GetSystemTimes` 三组累计时间，kernel 含 idle，负载为差分后的 `(kernel + user - idle) / (kernel + user)`；新采样会话的首个 CPU 值保持 null。`GetActiveProcessorCount(ALL_PROCESSOR_GROUPS)` 得到超过 64 个逻辑处理器时，不调用受限聚合路径来冒充全机百分比。RAM 使用 `GlobalMemoryStatusEx` 的物理总量和可用量，已用为两者之差。E1 公式与边界用例通过；接入真实窗口的生命周期与当前机器读数由 G4-C2 验证。 | [Microsoft GetSystemTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getsystemtimes)、[GetActiveProcessorCount](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getactiveprocessorcount)、[GlobalMemoryStatusEx](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-globalmemorystatusex)、[G4-C1 result](evidence/G4-C1/result.md) / E0、E1 |
| F-060 | G4-C2 隔离 Tauri Release 的只读 UIA 观测确认真实系统链路：CPU 首个值显示“采样中”，后续为 31%；两个短时 CPU worker 运行后样本为 40%；RAM 显示 15.8 / 31.8 GiB。该观察证明本机 API 和摘要工作，不是性能基线。真实面板/隐藏 E2 未完成：无前台激活的跳过任务栏挂件拒绝 `SetForegroundWindow`，PID/前台守卫正确阻止了按钮输入。当前没有用本卡 Release 验证其他前台入口。 | [G4-C2 read-only E4](evidence/G4-C2/metrics-readonly-e4-20260926-035601-416.json)、[UIA attempt](evidence/G4-C2/metrics-ui-e2-20260926-034935-378.json)、[probe source](evidence/G4-C2/metrics-ui-e2-probe.ps1) / E2/E4 |
| F-061 | 补充并更新 F-060 的前台入口缺口：固定 SHA `400A2B...FF7F2` 的真实 E2 用 UIA 精确调用 Explorer 下 `Widget Platform` 托盘 `SystemTray.NormalButton`，将确切应用 PID 切到前台。CPU 首样显示“采样中”、后续为 24%；CPU 面板明确 20 逻辑处理器/约 2 秒，RAM 为 16.1 / 31.8 GiB 并明确物理内存口径；两个受控线程负载时 CPU 为 28%。隐藏/恢复尚未测：启用的“打开停靠设置”按钮属于目标窗口后代，但 UIA 未提供 `InvokePattern`，守卫在点击前停止，没有用坐标或合成输入。G4-C2 仍为 implemented_unverified。 | [partial E2](evidence/G4-C2/metrics-ui-e2-20260926-042528-205.json)、[result](evidence/G4-C2/result.md)、[probe](evidence/G4-C2/metrics-ui-e2-probe.ps1) / E2 |
| F-062 | 后续最终 G4-C2 E2 以安全的语义 UIA pattern 补齐 F-061 缺口：设置入口没有 InvokePattern，但准确元素提供 `ExpandCollapsePattern` 且状态为 Collapsed；对该精确目标执行 Expand 后，以 InvokePattern 选择“位置与交互”和“立即收起/恢复摘要栏”。隔离 Release E2 11 项全部通过：CPU 首样为空、摘要 21%、20 逻辑处理器/约 2 秒、RAM 16.2/31.8 GiB、双线程负载 CPU 33%，隐藏条恢复后 CPU 首样重新为空且 RAM 采样恢复。探针 SHA 固定并在结束时无残留。F-061 的“隐藏/恢复未测”状态已由该最终证据取代。微软 UIA 文档说明 Invoke、ExpandCollapse、Toggle 是不同语义模式；仅在元素报告相应模式及 expected state 时执行 Expand。 | [final E2](evidence/G4-C2/metrics-ui-e2-20260926-044013-176.json)、[result](evidence/G4-C2/result.md)、[Microsoft InvokePattern semantics](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.invokepattern?view=netframework-4.8.1)、[Microsoft ExpandCollapsePattern](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.expandcollapsepattern?view=netframework-10.0) / E2 |
| F-063 | G4-A 现有一个 Windows-only ignored 手动 E2 probe：必须显式确认只读授权、关闭其他媒体 session，并提供一/二个允许的 AUMID marker 后才调用 GSMTC；默认 cargo test 会跳过。它只记录 allowlist session，封面只记状态/MIME/字节数，不保存图像且不发播放控制。新增后的全 Rust suite 44 passed、1 ignored，真实 E2/E4 仍未执行；还需验证双 session 切换/暂停/关闭与文本保留时的封面缺失/失败。 | [probe](app/src-tauri/src/features/media/tests.rs)、[E1 log](evidence/G4-A/media-probe-harness-test.log)、[G4-A result](evidence/G4-A/result.md) / E1, privacy gate |
| F-064 | 2026-09-26 网易云与 Edge 获准的只读探针首次有效运行：GSMTC health available；识别 `cloudmusic.exe`/`MSEdge`，记录暂停、Edge 会话移除、文字存在时一次 `ArtworkUnavailable`（随后重试成功）。所有媒体文本字段在证据日志中脱敏。current-session ID 未匹配；300 秒结束时测试进程以 `0xC0000005` 在 `windows_core::IUnknown::drop` 附近崩溃，E2 不通过。代码已改用会话接口原指针并在唯一来源 AUMID 时回退匹配，E1 45/0/1；干净停止、当前会话切换和修复后的 E2 未验证。 | [probe log](evidence/G4-A/live-probe-20260926-141151.log)、[crash record](evidence/G4-A/live-probe-20260926-141151-crash-event.txt)、[result](evidence/G4-A/result.md) / partial E2, E1, crash |
| F-065 | 2026-09-26 第二轮获准 live probe 记录到来源、暂停、切换/移除和成功封面读取，但 raw `GsmtcSession` 接口地址在刷新间变化，令同来源 session ID 抖动；停止 checkpoint 后仍发生 `0xC0000005`。事件 PDB 地址位于 `windows_core::unknown::IUnknown::drop`。源码检查发现 `RequestAsync` operation 可能在 `CoUninitialize` 后才被隐式释放；代码已改为在 apartment 存活期间显式 drop operation，并改回 canonical IUnknown session identity。fmt 与默认 suite 45/0/1 通过；修复后 live 结果、干净停止与 MEDIA-01 封面错误仍未验证，最后一次获准重试待用。 | [second probe log](evidence/G4-A/live-probe-20260926-150220-rerun.log)、[crash record](evidence/G4-A/live-probe-20260926-150220-rerun-crash-event.txt)、[E1 logs](evidence/G4-A/e1-cleanup-order-20260926-cargo-test.log) / observed runtime, source-based diagnosis, E1 PASS, E2 UNVERIFIED |

| F-066 | 2026-09-26 canonical IUnknown key 与 shutdown 修复后，真实 probe 已 clean-stop（`monitorStopped:true`），但两条允许来源产生六个历史 session ID。源码中唯一 AUMID fallback 仅用于 `GetCurrentSession`，`sync_sessions` 仍按枚举对象身份建表；现对当前列表与既有条目都唯一的来源复用公开 ID，重复来源保持 ambiguous。COM 文档保证同一个对象的 IID_IUnknown 查询返回同一 pointer；本机记录只能说明枚举身份未维持监视器 ID，不能断言 Windows 重建了对象还是包装器变化。E1 46/0/1；修复后的 live ID 稳定性待验证。该待验证项已由 F-067 后续实测更新。 | [third probe log](evidence/G4-A/live-probe-20260926-153309-final.log)、[identity rule](https://learn.microsoft.com/en-us/windows/win32/com/rules-for-implementing-queryinterface)、[E1 log](evidence/G4-A/e1-session-source-fallback-20260926-cargo-test.log) / observed runtime, source fact, inference, E1 PASS, E2 UNVERIFIED |
| F-067 | 2026-09-26 在唯一 AUMID source reconciliation 修复后，网易云 (`cloudmusic.exe`) 与 Edge (`MSEdge`) 两路均处于播放时，真实 probe 读到 2 个 session 和两路 artwork；用户暂停网易云、关闭 Edge 视频页后，记录 current-session switch=1、pause/removal=true、same-source ID churn=0、monitorStopped=true，测试 exit 0。结合首轮带文字元数据的封面失败，满足本机这两种来源的 G4-A / MEDIA-01 bounded E2/E4 流程。日志仅含字段存在性，不含正文。重复同 AUMID session 的消歧、其他播放器、100 次 UI 开关及 G4-B 实际控制仍未验证。 | [successful probe](evidence/G4-A/live-probe-20260926-2103-resumed.log), [prior artwork failure](evidence/G4-A/live-probe-20260926-141151.log), [G4-A result](evidence/G4-A/result.md) / E2/E4 pass within named sources, bounded lifecycle |
| F-068 | 直接 `cargo build --release` 不会刷新 Vite 前端；本机 `app/dist` 仍是 2026-09-25 产物，首个 G4-B2 启动因此没有本轮 UI。使用 Tauri CLI Release build 并指定 evidence-local `frontendDist` 后，修正版窗口出现 7 个模块和真实媒体面板。后续需要确认 UI 的 Release 构建应把当前前端产物和 native binary 放在同一次 Tauri build 中；原始 UI 失败与修正过程见 attempts。 | [G4-B2 attempts](evidence/G4-B2/attempts.md), [Tauri Release log](evidence/G4-B2/tauri-release-build.log), [runtime UIA](evidence/G4-B2/release-panel-uia-check.json) / build and E2 observation |
| F-069 | 2026-09-26 B2 Release 仍在运行时，Windows 锁定共享 `app/src-tauri/target/release/widget-platform-app.exe`，覆盖链接失败。为保留用户窗口并独立核验新版 UI，可将 `CARGO_TARGET_DIR` 指到任务证据目录，并给临时 Tauri UI 检查副本使用隔离 identifier；该副本使用独立设置目录，不能代替生产 identifier/用户配置验收。 | [G4-B3 attempts](evidence/G4-B3/attempts.md), [isolated Release build](evidence/G4-B3/b3b-tauri-release-build-isolated.log), [UI check](evidence/G4-B3/b3b-release-ui-check.json) / Windows file lock and verification isolation |
| F-070 | 2026-09-27 用户授权后，在当前网易云播放会话上发送一次 pause，真实 provider 返回 accepted，状态变为 paused；一次 play 恢复也返回 accepted，最终状态 playing。未观察到 provider false/exception；未切歌、seek、关闭播放器或注入错误。该真实尝试不能关闭 MEDIA-02 剩余门槛。 | [G4-B3 live failure attempt](evidence/G4-B3/live-failure-attempt-20260927.json) / bounded E2/E4, accepted control, failure path UNVERIFIED |
| F-071 | 2026-09-27 用户授权的 Edge 页面关闭探测经窗口标题与所选媒体标题在内存中匹配到唯一 Edge 窗口，但当前进程无法将 Edge 激活到前台：`SetForegroundWindow` 后前台仍为 PID 13224；`WScript.Shell.AppActivate(28612)` 返回 false，前台仍为 PID 13224。两次都在发送输入前停止；没有关闭网页或发送媒体控制。安全继续条件是用户先将匹配的播放页切到前台。 | [G4-B3 attempts](evidence/G4-B3/attempts.md) / desktop foreground guard, no input sent |
| F-072 | 2026-09-27 用户报告真实视频播放时应用可暂停/播放/下一集，关闭网页后媒体会话消失，重开后恢复；随后明确要求 G4-B3 与 Goal 4 直接记通过并接受 provider false/异常没有自然出现的覆盖缺口。按 E5 用户验收关闭当前范围，不能将其描述为 E2/E4 的 provider false/异常实测。 | [G4-B3 result](evidence/G4-B3/result.md) / explicit user acceptance and evidence boundary |
| F-073 | 2026-09-27 复核发现正式 Shell 的 Todo 一级摘要仍是静态对号，未接入已保存 `TodoSnapshot`，与 PRD §5 / 获批 UI-D1 v2 不一致。G3-E 已让 Shell 与 TodoPanel 共用单个 `TodoSnapshotStore`，按可见/启用状态连接与释放；摘要现在显示完成数、进度、无障碍状态，并沿用原型每 3 秒对号/完成数交替。E1 模型 7/7、全前端 70/70、typecheck/build PASS；隔离 Release E2 真实验证 0/1→1/1、关闭面板仍同步、3 秒切换、删除后 0/0。唯一探针 Bundle ID 的 AppLocalData 仍留有 EBWebView 与空列表 SQLite；递归清理守卫因发现 EBWebView 而停止，未删除。哥哥当前已打开的 G4-B3 二进制未替换，正式 Todo 数据未读取或改动。 | [G3-E result](evidence/G3-E/result.md), [partial](evidence/G3-E/ui-summary-partial.png), [complete](evidence/G3-E/ui-summary-complete-panel.png), [closed](evidence/G3-E/ui-summary-complete-closed.png), [phase](evidence/G3-E/ui-summary-phase-toggle.png) / E1, E2, lifecycle |

| F-074 | 2026-09-27 G3-E 独立复核发现 Todo 摘要重连时需标记缓存为上次已知，并且 `listen()` / 初始 `snapshot()` 的 retryable 连接失败需重试。已增加 `idle/syncing/ready/failed` 状态、5 秒 retryable 建连重试；前端全量 72/72，Todo 子套件 13/13，最终只读复核无阻断。能力边界：当前 `TodoBridge.listen` 只返回 unsubscribe，无建立后断线/健康信号；真实 Tauri 故障恢复 E2 与静默 listener 掉线检测仍未验证，后续若要支持需补原生桥状态通知，并测试 listen 拒绝、pending promise disconnect、timer 取消。 | [G3-E follow-up](evidence/G3-E/result.md) / E1, review, real failure recovery UNVERIFIED |
| F-075 | 2026-09-27 G1-D WPF Release 是 framework-dependent；直接启动 EXE、没有项目局部 `DOTNET_ROOT` 时会打开 .NET 运行时安装提示。应通过项目局部 `.tools/dotnet` 环境启动，不做系统级安装。本轮正确启动后显示的是 WPF 路线对照原型（`SYSTEM SAMPLE / Ready · 23%`），不是当前 Tauri 产品；用户指出目标不符后未做任何控件/托盘输入。Launch probe 记录 `buttonHitBelongsToWpf=false`，该轮不构成 E2；精确测试 PID 随后退出。 | [G1-D-F1 attempt](evidence/G1-D/g1d-f1-attempts-20260927.md)、[launch probe](evidence/G1-D/launch-probe-g1d-f1-20260927.json)、[captured old UI](evidence/G1-D/g1d-f1-old-ui-20260927.png) / E2 attempt, UNVERIFIED |

| F-076 | 2026-09-27 G5-A 核对 OpenAI Codex app-server v2 schema：兼容单桶 `rateLimits` 与按 limit ID 分桶的 `rateLimitsByLimitId` 并存；app-server 把缺少 limit ID 的 snapshot 归到 `codex`；核心 `codex` 缺失时不拿其他桶替代。官方 TUI 将 `resetsAt` 按 Unix 秒转 UTC，并以 15 分钟作为界面 stale 年龄阈值。G5-A 纯解析/UI与 v1/v2→v3 设置迁移 E1 通过：前端 92/92，Rust 52/0/1，fmt/check PASS。最初裸跑 `cargo` 的 exit 127 是遗漏 `app/run-msvc-rust.cmd` 项目 wrapper，发现并使用 `prototypes/tauri-shell/.tools` 后解除；不需要安装或修改系统工具链。项目 PRD 未规定年龄型 stale 阈值，本卡在刷新失败后保留 last-good 并标 stale，年龄阈值留待 G5-B 刷新方案。未做真实账号读取。 | [官方 schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json)、[官方 response assembly](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor.rs)、[官方 TUI time/stale behavior](https://github.com/openai/codex/blob/main/codex-rs/tui/src/status/rate_limits.rs)、[G5-A result](evidence/G5-A/result.md)、[attempts](evidence/G5-A/attempts.md) / G5-A E1 PASS; live data/E2 UNVERIFIED |
| F-077 | 2026-09-27 本地 app-server 探针先经合成子进程验证通知处理、RPC错误脱敏、超时、输出限额、取消和子进程回收。第一轮真实 quota 调用因方法消息处理过早且缺少 gateway 状态前置而失败；在哥哥授权 `account/gatewayOAuth/read` 只读检查与一次 quota 重试后，正确顺序成功。CODEX-02 单次真实客户端读取 E4 PASS：只保存两种 rate-limits 字段类型、一个 bucket、codex core、primary/secondary 窗口字段类型与 observation timestamp；未保存额度值、provider 名称、token 或完整响应。Codex CLI `0.158.0-alpha.2.1` 签名 OpenAI / Valid。此临时探针结果不替代产品 Rust transport 的 E1 测试；生产 transport/进程管理实现仍待做。 | [G5-B result](evidence/G5-B/result.md)、[official app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)、[rate-limits schema](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json) / CODEX-02 E4 PASS; product E1 pending |
| F-078 | 2026-09-27 G5-B 产品 Rust transport E1/E4：全量 Rust tests 66 passed/0 failed/2 ignored，fmt、debug/release check PASS；获明确授权后单独运行真实 Rust quota 测试 1/1 PASS。测试只保留测试结果，响应值、原始响应和凭据未记录；该授权已用完，不得重复真实 quota read。新增 JSON-RPC 顺序/白名单响应、gateway-not-ready、429不重试、登录请求拒绝、RPC错误脱敏、超时、单行/总输出限制、取消及 child wait/reap 测试。Tauri command future 取消时必须把取消信号交给 blocking worker，但 active 槽位要由 worker 持有至进程清理完成，不能由已取消的 command future 提前释放。前端接线不在当前 G5-B 卡允许路径内，未改动，需另排任务。 | [G5-B result](evidence/G5-B/result.md)、[rust-tests.log](evidence/G5-B/rust-tests.log)、[rust-live-test.log](evidence/G5-B/rust-live-test.log)、[rust-check.log](evidence/G5-B/rust-check.log)、[rust-release-check.log](evidence/G5-B/rust-release-check.log) / product E1/E4 PASS |
| F-079 | 2026-09-27 G5-C 核对本机 Hermes `v0.21.5+3397.gd25bbd0` 的真实事件生产代码。`turn_finalizer.finalize_turn` 每轮发出 `on_session_end`，其 `completed` 是 turn 结果，不足以表示整个用户任务 Done。subagent start/stop 提供 `child_session_id`，但 child `status=completed` 也涵盖有可用摘要的 `max_iterations`，stop hook 未携带 `exit_reason/truncated`，故不作为“明确成功完成”证据。Kanban `kanban_task_completed` 在任务完成写入后触发并携带 `task_id/run_id`；它与当前 Agent `sessionId` 契约是不同身份维度。当前 reducer 契约保持 `sessionId` 范围，普通 turn 成功结束只显示 Waiting、不标 Done；本轮无法核实该契约是否来自 2026-09-27 用户原话。哥哥于 2026-09-28 明确接受 G5-C 保持 partial，产品运行时桥/UI 不纳入本轮 G5 收口。纯 reducer E1 定向 11/11 PASS。两条迟到事件回归先红后绿；最近 64 个完成 turn ID 有界缓存。离线 Hook 白名单探针 8/8 PASS，stdout 固定 `{}`，capture 只保存脱敏字段。一次获准的真实 Hermes CLI turn 触发 `pre_api_request` 与 `on_session_end`；前者 session/turn 字段存在、provider=`openai-codex`，后者 `completed=true`、`failed=false`、`interrupted=false`。这只通过源事件形状 E4，不代表产品接线。临时两键配置已 unset，exact config readback empty；`hermes hooks revoke` 移除 2 个 exact approvals，Hermes venv 定向复查均 absent。第一次系统 Python 复查因缺 `ruamel` 失败，换 Hermes venv 后通过。全 Rust 77/0/2，fmt/debug/release check PASS；产品 runtime bridge/UI、审批/长工具映射仍未实现，AGENT-01 保持部分完成。 | 本机只读源码：`agent/turn_finalizer.py:509-576,765-779`、`tools/delegate_tool.py:292-296`、`tools/delegate_tool_child_run.py:580-607`、`tools/delegate_tool_results.py:345-372`、`hermes_cli/kanban_db.py:162-167,2828-2835`、`hermes_cli/plugins.py:158-168`；[capability review](evidence/G5-C/capability-review.md)、`evidence/G5-C/hook-live-result.md`、`evidence/G5-C/hook-observation.redacted.jsonl`、`evidence/G5-C/hook-config-write.log`、`evidence/G5-C/hook-config-rollback.log`、`evidence/G5-C/hook-probe-tests.log`、`evidence/G5-C/rust-tests.log`、`evidence/G5-C/rust-targeted.log` / reducer and one-turn source probe PASS; AGENT-01 partial |
| F-080 | 2026-09-27 G5-B-UI 核验：`CodexPanel` 与额度 parser/model 已存在，但 `ShellFrame` 原先使用静态初始状态，前端未接 Tauri command。现有 `codex_quota_read` 无业务参数并返回带后端 `observedAtMs` 的白名单 `Value`；`codex_quota_cancel` 只取消当前活跃读取。`CodexRuntime` 成功后至少 5 分钟不再读，失败指数退避最高 1 小时，但不缓存 quota snapshot；冷却期返回 `refreshNotDue` 与 `retryAfterMs`。取消也以失败进入退避。因此 UI 必须将 last-good state 保存在 ShellFrame/store 跨面板隐藏保留，尊重冷却且不把 `refreshNotDue` 当成新数据；若前端状态在 Rust runtime 仍存活时丢失，冷却期没有可恢复 snapshot，应诚实显示 unavailable。真实面板会触发 Tauri quota read。2026-09-28（Asia/Shanghai）获准的一次隔离 Release 读取已执行：Codex-only 窗口显示 fresh 状态、核心主窗口数据行、来源和观察时间，并观察到一个 Codex CLI 子进程；实际额度值和原始响应未记录。探针未触发正常托盘退出，随后强制结束本次精确进程，整体 E2/E4 保持 UNVERIFIED；在线失败降级未测。静态对照已通过的 G2-A 探针发现，G5 清理阶段在托盘图标 Invoke 后立即单次查菜单项，没有等待/轮询，且空 `catch` 未记录失败阶段；疑似探针竞态但尚未实测确认，不归因产品缺陷。此前单次授权已消耗。哥哥于 2026-09-28 新增授权一次真实读取：第一次直接启动的 UI 预览缺少 `WIDGET_CODEX_CLI_PATH`，command 在 CLI spawn 前返回 `notConnected`，没有外部 account RPC；使用进程级隔离环境与 task-local profile 后，只打开一次 Codex 面板便显示 fresh 状态、核心窗口数据、来源和更新时间。额度值、重置时间、原始响应和 auth 内容均未保存；应用保持打开。新增授权现已消耗，正常托盘退出和在线失败降级仍 UNVERIFIED。前端接线 E1 仍为 16 files/118 tests、typecheck、build PASS。 | `app/src/features/codex/CodexPanel.tsx`、`codex-quota-model.ts`、`app/src/shell/ShellFrame.tsx`、`app/src-tauri/src/features/codex/commands.rs:7-36`、`runtime.rs:6-7,22-34,55-69,145-163`；[G5-B-UI result](evidence/G5-B-UI/result.md) 与 frontend logs / E1 PASS；live E2/E4 UNVERIFIED |
| F-081 | 2026-09-28 G5-B-UI 对同一精确隔离 Release 进程执行正常托盘退出 E2：PID/路径与 Release SHA-256 守卫匹配；主窗体正常收至托盘，唯一 Widget Platform 托盘按钮及“退出 Widget Platform”菜单项均成功调用，进程自然退出，无强制清理且无直接 codex.exe 子进程；该探针未打开 Codex 面板或发起额度读取。正常托盘退出 E2 PASS。在线失败降级仍无 Release 证据，E2/E4 整体仍 UNVERIFIED；现有 E1 测试覆盖错误与 last-good，额度授权已耗尽不重读。哥哥于 2026-09-28 明确接受 G5-C 保持 partial，Agent 产品桥/UI 不纳入本轮 G5 收口；不将此范围决定追溯归因到未核实的 2026-09-27 原话。同日另明确接受在线失败降级保持 UNVERIFIED，以“限制已记录的部分完成”收口 G5；不宣称 E2/E4 全项通过。 | `evidence/G5-B-UI/tray-exit-20260928.json`、`evidence/G5-B-UI/verify-normal-tray-exit.ps1`、`evidence/G5-B-UI/result.md` / tray exit E2 PASS; live online failure UNVERIFIED; G5-C partial accepted |\n\n| F-082 | 2026-09-28 G6-A Weather 使用固定 HTTPS Open-Meteo endpoint，不需要账户或 API key；城市名不发送，只有用户显式配置的坐标、真实 IANA 时区和单位进入查询。成功按完整位置缓存 30 分钟，失败按位置退避并保留 last-good 原观察时间；取消不计失败，cancel 按位置限定以避免旧 IPC 误杀新请求。响应逐 chunk 限制 512 KiB，磁盘缓存先按 1 MiB 元数据门禁再有界读取并校验快照。两轮只读审查发现的问题均按 TDD 修复。最终前端 140/140、Rust 92/0/3、fmt/typecheck/build/debug/release check PASS；一次 Berlin 固定公共坐标真实查询 1/1 PASS，未读取用户位置或保存天气值/完整响应。发布或商业化前仍须重新核对当时 Open-Meteo 条款、额度和端点。 | [G6-A result](evidence/G6-A/result.md)、[live query](evidence/G6-A/live-query.md)、[provider review](evidence/G6-A/provider-review.md) / E1、E4 |
| F-083 | 2026-09-28 G6-B Clipboard 领域合同完成：默认关闭，只接受纯文本；CRLF/CR 标准化为 LF；空/NUL/显式排除/自有恢复候选不入历史；相邻去重。默认 7 天、200 条未 Pin、10 MiB，总量不足不静默删除 Pin；保留期覆盖所有有效捕获、浏览/分页/恢复/Pin 变更，回拨时一次性清除未 Pin 并重建基线，过期 Pin 在 Unpin 时删除。恢复 marker 由进程内实例 ID 与单调序号生成，队列满 64 项拒绝新恢复而不丢旧 marker。来源只接受受限 `.exe` basename/AUMID；保护抽象固定 CurrentUser 且错误不回显正文。三轮独立审查问题均按 TDD 关闭；定向 16/16、全 Rust 108/0/3、fmt/release/diff check PASS。未启用 Win32 Clipboard feature、listener、IPC、数据库或真实采集。 | [G6-B result](evidence/G6-B/result.md)、`app/src-tauri/src/features/clipboard/**` / CLIP-01 E1、SEC-01 |
| F-084 | 2026-09-29 图标统一规划的静态盘点：根目录 `icon/` 有 23 个可解析 SVG，均为 24×24、`stroke=currentColor`；当前摘要和设置注册表仍有字符/emoji（`ShellFrame.tsx`、`settings-model.ts`），媒体面板也有字符控制；应用/托盘仍用 `app/assets/widget-platform-icon.svg` 与 `app/src-tauri/icons/icon.ico`。`icon/` 未见独立 LICENSE/来源说明、明确品牌图，以及上一首/下一首、关闭等直接匹配资源。故规划 G2-UI-C 并将素材来源/许可、缺图补齐与真实窗口/最终制品复核列为完成条件；此次只改文档，不宣称资源授权、替换或 UI-03 通过。 | `icon/*.svg`、`app/src/shell/ShellFrame.tsx`、`app/src/settings/settings-model.ts`、`app/src/features/media/MediaPanel.tsx`、`app/src-tauri/tauri.conf.json`、`app/src-tauri/src/lib.rs` / E0 盘点；UI-03 E1/E2/E3 UNVERIFIED |
| F-085 | UI-03 深化盘点：天气代码 3 当前是阴天字符，但 `icon/` 缺纯云图；设置“外观/位置与交互”、关闭、上下、上一首/下一首、Todo 未完成圈也无明确对应。23 个 SVG 使用 `currentColor`，不能在未经实际渲染验证时假设 `<img>` 会继承主题色；目前无 SVG 脚本/外链/事件属性只是静态结构事实。为防图标测试触发真实 Codex 额度、Clipboard listener、媒体控制或天气联网，E1 用合成状态、E2 用隔离安全配置测窗口/托盘；缺口和逐关证据见专文。G2-UI-C 仍为 not_started，本轮没有产品运行或图标替换。 | [图标资源与替换验收](图标资源与替换验收.md)、`app/src/features/weather/weather-model.ts:194-235`、`app/src/settings/SettingsPanel.tsx:35-65,223-316`、`app/src/features/media/MediaPanel.tsx:297-322` / E0；E1/E2/E3 UNVERIFIED |
| F-086 | 2026-09-29 后续增补将 F-084/F-085 的**当时 23 项/缺图结论**更新为当前事实：`icon/` 现有 43 个结构一致的 SVG，补有纯云、操作图标、未知/未验证备选和五个品牌候选；未删旧资产。哥哥明确要求 `cloud-off` 专用于天气**数据不可用**；“未配置”与“未知天气代码”分别用文字，问号图仅作未知/未验证候选，不从素材推断产品数据质量。品牌尚未最终选择；隔离小图预览里普通 `<img>` 的 `currentColor` 在深底仍呈黑色，最终 WebView 着色和真实托盘 16px 未验证。目录未见独立来源/分发许可说明；应用代码、旧品牌 ICO 和产品 E1/E2/E3 均未改/未跑，G2-UI-C 保持 not_started。 | [43 项现行清单与执行合同](图标资源与替换验收.md)、`icon/*.svg` / E0 结构核对与隔离视觉预评阅；产品 E1/E2/E3 UNVERIFIED |
| F-087 | 2026-09-29 哥哥选定 `icon/blocks.svg` 为品牌图源，并说明素材好像来自 Lucide。独立只读核对官方仓库 commit `66d8f9fc394b8530377e5f6112f0b8908ba01280`：本地 43/43 个 SVG 原始字节与官方一致；其中 41 个同名、`trash-2.svg` 对应当前上游 `trash.svg`、`widget-platform.svg` 对应上游 `app-window.svg`。这验证**内容对应**，不证明当时下载入口；固定 commit 的官方 LICENSE 含 ISC 与部分 Feather 来源图标的 MIT 条款，分发时需保留完整适用版权/许可声明。E0 来源/许可条款/品牌选择子项 PASS，品牌图实际 16px/浅深色、ICO/托盘、发布许可随包及 UI-03 E1/E2/E3 均未验证；G2-UI-C 仍 not_started。F-086 的“品牌尚未选择、目录无来源说明”是当时状态，由本条部分更新，不追溯改写。 | [来源与品牌核验](evidence/G2-UI-C/source-review.md)、[官方固定 LICENSE](https://github.com/lucide-icons/lucide/blob/66d8f9fc394b8530377e5f6112f0b8908ba01280/LICENSE) / E0 子项 PASS；产品 E1/E2/E3 UNVERIFIED |

| F-088 | 2026-09-29 G7-A 硬件检视：本机真实 DXGI adapter 为 NVIDIA GeForce RTX 4060 Laptop GPU，LUID `00000000:0001209A`；DXGI `QueryVideoMemoryInfo` 读到进程级专用预算约 7.0 GiB、共享预算约 15.1 GiB，不代表整卡。PDH wildcard counter set 发现 GPU Adapter Memory 与 GPU Engine；经两次采样、按返回字节数分配 buffer、LUID 匹配后，隔离 Release 读到整卡 dedicated 2.7 GiB、shared 0.1 GiB、engine 67.3%。G7-A1/A2 E1 与真实 E2/E4 均通过，证据见 `evidence/G7-A1/result.md` 与 `evidence/G7-A2/result.md`；仅覆盖当前 NVIDIA 机器。硬件温度检视结果保留在历史证据，但按用户决定不属于当前产品范围。 | G7-A | 实测、官方 NVIDIA nvidia-smi 语义；其他厂商/混合 GPU 未验证 |

| F-089 | 2026-09-29 G8-A 预检发现无设置文件时前后端默认模块列表均含 Clipboard，且 Shell 对显示模块自动启用监听，与 PRD/G6-B 的默认不采集合同冲突。新安装默认修复先 RED→GREEN；哥哥随后确认旧设置首次升级即统一停止监听、保留历史、手动重新显示才恢复。设置升至 v5，读 v1–v4 时剔除 Clipboard 且不覆盖原文件，v5 显式启用可持久保存。最终前端 160/160、Rust 138/0/3、typecheck/build/fmt/release check PASS；隔离 Release SHA `EDB84493…D88B1` 新安装真实窗口 UIA 未见 Clipboard 一级入口，但没有直接观测 listener 注册，旧设置的原生升级 E2 和托盘退出仍 UNVERIFIED。G2-UI-C 尚未实施，P0–P7/24h/最终 E3 不能凭本轮结果通过。 | [G8-A result](evidence/G8-A/result.md)、`app/src/settings/settings-model.ts`、`app/src-tauri/src/host/settings.rs` / E1 PASS，局部 E2；最终性能 UNVERIFIED |

| F-090 | 2026-09-30 G2-UI-C C2-Todo：面板行图形替换不会自动覆盖 createPortal 拖动浮层。真实浏览器按下鼠标捕获到浮层仍有 ⋮⋮/○/× 且本地图标数为 0；只替换浮层图形后，鼠标排序与浮层回收通过，原行点击区域保持。Todo E1 11/11、完整前端 167/167、构建与 C1 72/72 回归 PASS。 | [C2-Todo 结果](evidence/G2-UI-C/c2-todo-20260930/result.md)、`ghost-red-result.json` / E1；原生 E2 未验证 |
| F-091 | 2026-09-30 普通 Vite dev 再次出现 ready 但页面 HTTP 超时，先前限定扫描入口不足以证明普通启动永久正常。仅本次使用 noDiscovery、显式 React 预打包、独立 scratch cacheDir 与排除生成目录 watcher 的启动参数，fixture HTTP 200 后完成 C2/C1 验收；未改产品配置，普通 dev 根因未确认。无扩展名 node 的程序启动曾报 stdin is not a tty，显式 node.exe 成功；不应据此重装 Node。 | [C2-Todo 环境边界](evidence/G2-UI-C/c2-todo-20260930/result.md) / 本轮实测；普通入口仍待诊断 |

| F-092 | 2026-09-30 图标装饰 span 会被共享 header span 说明文字规则意外染为 muted；Timer 实测发现后，进一步真实 Shell 集成确认 Todo 同类问题。共享选择器排除 .local-icon，撤掉模块局部补丁，修复同一类根因；原说明文字、40×40 返回区域及业务逻辑保持。Timer/集成 21/21、全量 170/170、构建、C1 72/72 与 Todo 11/11 最终回归 PASS。 | [C2-Timer](evidence/G2-UI-C/c2-timer-20260930/result.md)、`shared-header-color-red.json` / E1；真实桌面未验证 |
| F-093 | 2026-09-30 CDP 输入验收必须先保证文档焦点，并发送完整键盘参数；逆向 Tab 可落入浏览器 chrome，document.hasFocus() 为 false，不能当按钮不可访问。bringToFront、从前一 DOM 控件发真实 Tab 恢复可靠路径；Enter 带回车文本才触发 Chromium 按钮完整激活。SVG data URL 不包含文件名，图形来源应核对本地/内联 URL 及实际 SVG 路径，不能以字符串文件名误判。 | [C2-Timer 脚本诊断](evidence/G2-UI-C/c2-timer-20260930/result.md) / 输入脚本问题，不冒充产品缺陷或原生键盘证据 |

| F-094 | 2026-09-30 C2-Media 只替换图形节点即可复用已有控制/能力/忙碌逻辑，CSS 保持字节一致。真实组件以合成 parsed view 和内存 bridge 验证四控制路由、切会话目标、pending 防重复、accepted/false/exception 文案及本地占位/封面分支；不能把 E1 false/exception 用作 G4 native provider 覆盖证据。意外 native 调用计数需跨场景累计，不能被 reset 清空。Media 39/39、全套 173/173、构建及 C1/Todo/Timer 同源码回归 PASS。 | [C2-Media 结果](evidence/G2-UI-C/c2-media-20260930/result.md)、`verification.json` / E1；真实媒体/原生 E2 未测试 |

| F-095 | 2026-09-30 C2-Metrics 的 CPU/RAM/GPU 共用同一 MetricsPanel；实际图形入口只有返回按钮，不应把指标名称、读数或 footer 状态点误当旧图标并增添装饰。两处 import/图形替换即可完成；SSR RED→GREEN、前端 175/175、Metrics E1 75/75 及 Media/C1/Todo/Timer 共 218 项同源码回归通过。CDP Browser.close 端点消失不等于启动句柄立即退出；首轮等待 10 秒超时，保留失败证据、最终等待 30 秒后全套通过，另以精确任务进程/端口读回证明回收。 | [C2-Metrics](evidence/G2-UI-C/c2-metrics-20260930/result.md)、`verification.json`、`cleanup-result.json` / E1；真实采样与 native 未测 |

| F-096 | 2026-09-30 C2-Codex 引入本地 SVG data URL 后，SSR 的“无虚构百分比”断言若扫描完整 HTML，会将百分号编码误判为额度；应仅断言实际文字，不能删掉无值门槛或修改产品数据。新旧四处断言定位后改为去标签/属性文字，旧测试三处变化独立逆向匹配原哈希；浏览器 textContent 另验无值分支。Codex E1 41/41、全套 176/176，六组同源码 259 项/39 图通过；未启动 app-server 或读取真实额度。 | [C2-Codex](evidence/G2-UI-C/c2-codex-20260930/result.md)、`return-green-attempt-1.log`、`verification.json` / E1；G5 native 失败分支未补测 |

| F-097 | 2026-09-30 C2-Weather与Clipboard的实际图形都只有返回入口；天气描述、温度、小时预报、Clipboard复制/删除/分页/条数是语义文字，不应因素材存在额外加图或改纯图标。顺序两批SSR RED→GREEN，两处import/图形替换保留业务源码；最后前端178/178、typecheck/build、八组同源码339项/55PNG PASS。Clipboard内存bridge验证copy/delete/clear、三个失败保留状态、pending单次提交、分页与卸载轮询停止；合成操作不证明系统Clipboard写回或listener。独立核验扫描禁用API时需区分“no navigator.clipboard”注释和真实代码；首次误报保留日志，修扫描范围后通过，未改变产品。119旁支文件（含43源SVG）未变、35复制SVG一致；精确任务Edge/Vite和端口均回收。C2全部E1 completed，C3/E2/E3与普通dev根因仍待验。 | [C2收口](evidence/G2-UI-C/c2-result.md)、[Weather](evidence/G2-UI-C/c2-weather-20260930/result.md)、[Clipboard](evidence/G2-UI-C/c2-clipboard-20260930/result.md)、`source-artifact-review.log` / E1 PASS；native/制品未验证 |

| F-098 | 2026-09-30 C3真实Release在设置城市输入时出现React根节点空白；异常栈与四处deferred updater测试一致，event.currentTarget在回调返回后已释放。哥哥批准最小F1修复后立即捕获value，四输入RED→GREEN；同新SHA真实WebView打字、浅深草稿、关闭和配置字节不变均通过。内存逆向撤销四处捕获精确匹配原源码SHA，证明没有顺手改保存/天气服务。前端182/182、Rust138/0/3与fresh构建PASS。 | [C3结果](evidence/G2-UI-C/c3-20260930/result.md)、`f1-verify/input-e2-scoped.json`、`final-independent-audit.json` / E1/E2 |
| F-099 | 2026-09-30 C3托盘左键真实出现精确PID的#32768菜单，当前UIA把该窗口暴露为无子项Pane；全桌面MenuItem过滤空不等于产品无菜单。菜单截图确认显示/退出两项后，以EXE路径/SHA/PID、唯一托盘、唯一自有菜单、已审阅矩形、前台/WindowFromPoint守卫做原生鼠标点击，显示及正常退出成功。600ms立即同rect断言失败保留，独立稳定读回与隐藏前相同；不在同步瞬间下产品尺寸异常结论。退出后应用+6个自有WebView全部不存在、9232已关闭。UIA无子项的系统/provider根因未下结论，未改产品或强制结束。 | [C3托盘/失败边界](evidence/G2-UI-C/c3-20260930/result.md)、`f1-verify/tray-direct-diagnostic.json`、`tray-exit-guarded-resume.json`、`geometry-e2-resume.json` / E2 |
| F-100 | 2026-09-30 C3同SHA真实窗口三组59项/26PNG，单屏144 DPI四边实际鼠标拖动与Win32外框0px贴边、浅深图形/面板/输入均通过；实际托盘图像子控件为24物理像素，16px层级由资源核对/预览证明，不能把该实拍称16px。左侧截图含真实悬停概况500 CSS px扩窗，不冒称390px摘要。22项独立审查确认325原基线只有四资产+SettingsPanel差异、F1后221源码未变、35SVG字节一致及7进程回收。C3实施前置已解除，G8最终性能/制品/许可/E5仍待验；高风险服务未因图标验收启用。 | [C3结果](evidence/G2-UI-C/c3-20260930/result.md)、`f1-verify/final-independent-audit.json` / E1/E2；E3/E5未验证 |

| F-101 | 2026-10-01 G8-A1测量判定必须独立于预算：未满120秒热身/600秒实际采样的诊断不能PASS PERF；当前子进程消失时最终CPU未知，不能只忽略退出进程后声称完整CPU。测量脚本新增protocol/退出CPU覆盖判定及EXE SHA，4项合成判定RED→GREEN，采样公式/预算未改。本轮新PID的P0/P1各121行CSV/120差分逐行重算与SHA/启动时间核对PASS。旧P0“synthetic”是脚本历史标签，实际生产WebView/空模块settings读回证明真实场景。 | [G8-A1收口](evidence/G8-A/run-20261001-0810/resume-20261001-1138/result.md)、`measure-verdict-{red,green}.log`、`final-independent-audit.json` / E1与局部E3 |
| F-102 | 2026-10-01 G8-A1真实P1第1次Todo关闭/重开丢草稿，旧SHA失败保留。TodoPanel局部useState随条件卸载销毁；把草稿持有到Shell同会话并受控接线，不新增磁盘持久化。成功提交仅清除仍等于提交内容的草稿，避免pending期间新输入被旧请求完成抹掉；4项原草稿+1项pending回归RED→GREEN。新SHA真实Return/Esc/设置重挂载及100次重开精确读回PASS。前端187/187、Rust138/0/3，续行327源码/资源文件未改。 | [结果](evidence/G8-A/run-20261001-0810/resume-20261001-1138/result.md)、`todo-draft-red.log`、`todo-pending-draft-red.log`、`draft-smoke-retry-e2.json`、`p1-ui-e2.json` / E1/E2 |
| F-103 | 2026-10-01安全五模块切换首轮34次后缺失打开，不能计作100次PASS。被动事件诊断第42轮记录pointerdown命中memory时viewport宽440，约3.8ms后pointerup已宽320且非按钮；观察证明本次输入跨了移动几何，不等于证明产品快速物理点击可靠。runner先等待目标/viewport稳定、elementFromPoint准确命中，再发送真实CDP按下/松开；一次有证据的新尝试从0完整100安全面板（每模块20）+100设置PASS，原失败与诊断保留，不改产品/不降低P0/P1门槛。资源5点始终7进程、根26线程/334句柄，Private Bytes首尾增13.609375MiB，峰增15.7734375MiB；短观察不能证明原生tokens/workers和24h无泄漏。 | [结果](evidence/G8-A/run-20261001-0810/resume-20261001-1138/result.md)、`lifecycle-click-diagnostic.json`、`safe-lifecycle-retry-e2.json`、`artifact-review.json` / 限定E2；快速物理点击未验 |
| F-104 | 2026-10-01续行原PID29904已不存在且退出原因未知，旧样本不拼接新PID；相同SHA/新profile/PID24988完整重测两场景。P0均CPU0.000912%、WS123.45MiB PASS，P1活动均CPU0.346106%、WS136.39MiB只列增量。精确托盘菜单Show/正常Exit后，捕获PID+startUtc、EXE路径及9233读回确认7进程/端口全部回收。任务profile由.gitignore排除，未读身份缓存内容，原证据仍可见。24h按哥哥明确决策不启动，媒体/天气新增授权未取得；本批E1/E2/局部E3收口不关闭G8-A、不启动G8-B/C。 | [结果](evidence/G8-A/run-20261001-0810/resume-20261001-1138/result.md)、`continuation-preflight.json`、`tray-{show,exit}.json`、`cleanup.json`、`ignore-verification.json` / E2及局部E3 |
| F-105 | 2026-10-01 G8-A2合同阶段核对源码：`enabledContentIds` 决定摘要模块集合；`visibility=hidden` 与禁用模块不同；metrics 只有启用 CPU/GPU/内存且摘要未隐藏、Settings 未覆盖时建立 consumer，默认约2秒采样，消费者归零清理 timeout；真实 Shell 的 Timer store 独立连接，不因活动面板关闭而停止。当前 SettingsPanel 可直接移除 Focus，因此“运行中禁用 Timer 必须明确取消或阻止保存”列为安全门，尚未把源码现状判为通过。合同阶段未改产品源码，P2/P3 E2/E3 尚未执行。 | [G8-A2合同](evidence/G8-A/run-20261001-0810/g8-a2/plan.md)、`source-contract.json`、`ShellFrame.tsx`、`metrics-store.ts`、`metrics-model.ts`、`SettingsPanel.tsx` / 源码事实与待验证边界 |
| F-106 | 2026-10-01 G8-A1-F2 根因与修复：真实事件链显示 hover 概况会把窗口扩为 popover，pointer press 生命周期中若 hover 清理继续运行，原生窗口可能在按下与松开之间切回 compact，造成旧轮 pointerdown/pointerup 命中不同 viewport。新增模块 pointer press guard：按下期间不调度 hover clear，释放后恢复清理；不改 native geometry 队列、业务 Store/IPC、CSS、设置 schema 或测试等待。定向回归先 7/8 RED 后 8/8 GREEN，全前端33 files/188 tests、typecheck/build PASS。新 SHA `70972fbe…d2a2e720` 隔离 Release 不加稳定等待以 Win32 mouse_event 完成100次内存面板点击，100/100读回PASS；第68轮runner超时后独立 Escape清理，完整open/close记录99次，不能把分段日志伪称100次完整读回。普通dev入口超时、P2/P3和24h不在本卡。 | [F2结果](evidence/G8-A/f2-20261001-1235/fixed/result.md)、`verification.json`、`direct-click-aggregate.json`、`native-dom-input.ps1` / E1、限定E2与边界 |

| F-107 | 2026-10-01 F2-R1接手复核发现按下保护只阻止新schedule，已启动nativeHoverTarget的成功/错误仍可在按下或切换CPU后清空hover。真实ShellFrame handler+可控native promise先取得三轮null≠memory/cpu失败，再加入revision失效与完成/错误按下guard；过期结果丢弃，当前错误仍报告。模块外shell释放/cancel原锁不复位，两项失败后根事件先复位press再调用既有drag处理，end guard避免重复调度。最终10定向/前端198、Rust138/0/3均PASS，生产只改ShellFrame，另两接手文件未变；不改native geometry/CSS/IPC/220ms延迟。 | [R1结果](evidence/G8-A/f2-20261001-1235/review-20261001-1405/result.md)、`hover-{red,switch-red,error-red,release-red}.log`、`source-review.diff` / E1 |
| F-108 | 2026-10-01 R1 fresh无feature隔离SHA2c6960df…06d53987、PID15612，旧250ms/650ms节奏五安全模块各20次、100完整面板/设置连续读回，真实Win32物理内存开合20次及模块外释放后hover恢复均PASS，不拼接超时尾段。UIA没有memory Button的首探针在press前停；备用helper dot-source后X/Y被同名params覆盖成0，receipt指出点在本应用左上角，不是产品失败。保存请求CSS对象再做DPR/client origin映射，独立逐项重算20次实际press通过；两轮UNVERIFIED保留，不加稳定等待或改产品来凑数。 | [R1结果](evidence/G8-A/f2-20261001-1235/review-20261001-1405/result.md)、`original-cadence-e2.json`、`physical-v2-e2.json`、`physical-harness-diagnosis.json` / E2 |
| F-109 | 2026-10-01 R1托盘Show可见/HWND读回成功，但600ms同rect断言未过；后续只读显示focusedModule=memory、内存概况及440×240 viewport/native660×360，不能把恢复焦点引出的popover与隐藏前compact直接判同框，也不把原失败改PASS。Escape关闭概况后正常托盘Exit及PID+startUtc/精确路径/9237确认7进程完全回收。Show原尺寸/焦点验收留G8复核；325接手基线仅ShellFrame变化、324未变+新测试，10项E2/120完整循环/6PNG独立核对PASS。新SHA未测P0/P1/24h，旧性能不回填；下一问题普通dev。 | [R1结果](evidence/G8-A/f2-20261001-1235/review-20261001-1405/result.md)、`tray-show{,-diagnostic}.json`、`tray-exit.json`、`cleanup.json`、`independent-audit.json` / 限定E2；Show原尺寸UNVERIFIED |

| F-110 | 2026-10-05 天气小时预报折线图：`HourlyChart`（SVG，preview/detail 两态）替换 12 小时卡片网格；detail 态用 `stroke-dasharray/dashoffset` 做从左到右生长动画（720ms，含 `prefers-reduced-motion` 降级），极值点标温度数字（最高 `#d9483b`、最低 `#2f6fd0`），折线下一行精简天气带（时间+图标+文字）。横轴取点抽成共享 `selectHourlyWindow`：以 `observedAtMs` 最近点为基准，向前 3、向后 8 共 12 点，使当前时刻落在第 4 位；超出范围贴边不报错。天气带方案 B 隔点显示（折线保留 12 圆点、天气带只 6 项、绝对定位不滚动）。前端 50 files/299 tests、tsc 干净。 | [result.md](evidence/weather-chart-media-preview-20261005/result.md) / E1 |
| F-111 | 2026-10-05 模块悬停预览通用插槽：`ShellModule` 新增可选 `previewContent?: ReactNode`，气泡渲染优先用它、否则回退 `previewLabel` 文字；天气/媒体各自提供纯展示卡片（气泡是 `aria-hidden` tooltip，内容不可交互）。媒体详情页播放/暂停合并为单个切换按钮（按 `playbackState` 决定图标/动作），共三个按钮。定位 `weather_locate` 改 async，`geocoding::reverse_name` 按经纬度反查城市名（count=1、language=zh），失败/无结果回退「当前位置」不阻断读取。Rust weather 23 passed/1 ignored。 | [result.md](evidence/weather-chart-media-preview-20261005/result.md) / E1 |
| F-112 | 2026-10-06 首次公开发布：仓库 `Astyyym/widget-platform`（public），首个 commit `d40f23c`（457 files / 17.5 MB，原根 Git 为 `main` 且无 commit）。发布前审计发现**原 `.gitignore` 会让约 34 GB 内容进入提交**：`evidence/**/cargo-target|target-final`（未匹配 `**/target/`）、`prototypes/*/.runtime*` 的 WebView2 profile（含 `Login Data`/`Cookies`/`Session Storage`）、`app/evidence/**` 整树。据此扩展 `.gitignore`：忽略 `evidence/`、`app/evidence/`、`**/.runtime*/`、`*.tgz`、`*.pma`、`*.hyb`、`*.nvph`、`*.dat`、`__pycache__/`、`*.pyc`。推送后按远端 tree 复核 457 blobs、可疑路径 0。 | [发布记录](evidence/publish-20261006/result.md) / E1 |
| F-113 | 2026-10-06 Release `v0.1.0` 资产复核：GitHub 会把资产名中的空格改写为 `.`，最终名为 `Widget.Platform_0.1.0_x64-setup.exe`（4,471,581 B）。**不能只信上传返回的 URL**：下载回本地重新计算 SHA-256 = `0bc1a3d7f11f374b585e7f0a0ea7c76ba54b734ebd0f2d138cac43157165e3c4`，与本地交付副本逐字节一致。README 内引用同步为改写后的资产名。发布说明中明确列出未验证项（多屏/混合 DPI、24h 常驻、跨版本升级、Codex 长时额度），不把构建通过当作桌面验收。 | [发布记录](evidence/publish-20261006/result.md) / E1 |

## 8. 新发现记录模板

~~~text
ID / 日期 / 任务：
现象：
类型：源码事实 / 官方文档 / 实测 / 推断 / 建议
复现步骤与证据：
影响：
决定与理由：
需要更新的需求/架构/测试：
尚未验证：
~~~

旧发现有变化时追加“被哪条决策/证据替代”，保留历史，不把旧未验证记录改写成当时已通过。
