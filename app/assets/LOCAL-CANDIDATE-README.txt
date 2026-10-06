Widget Platform 0.1.0 — 本地测试候选包（不是已完成整体验收的正式版本）

运行条件：Windows x64，已有 Microsoft Edge WebView2 Runtime。此包不会安装或更新 WebView2；缺少运行时不能运行。
当前用户安装，不需要管理员权限。不自启，不安装驱动，没有自动更新/feed/更新签名功能。
程序驻留托盘；点击托盘菜单“显示主窗口”可找回，“退出 Widget Platform”正常结束后台功能。

数据与卸载：
- 设置：%USERPROFILE%\.widget-platform\com.widgetplatform.desktop\settings.json
- Todo/Timer/加密 Clipboard 库及 WebView2 缓存：%LOCALAPPDATA%\com.widgetplatform.desktop\
- 安装覆盖/同版本重装不应删除上述数据。卸载默认保留数据；不要勾选卸载器的“删除应用数据”选项。
- 上游卸载器的删除数据选项只影响 AppData 数据，不能清理另存的 .widget-platform 设置。因此这里不宣称完整清除用户数据；本轮只验收保留数据。
- Clipboard 新装默认关闭；旧设置升级统一关闭该模块并保留历史，需手动重新显示才会恢复监听。
- Codex 只有打开额度面板才通过官方客户端读取，需已有客户端环境；不要把额度与 Agent 任务完成混同。

已实现模块：Todo、Focus/Break Timer、CPU/RAM/GPU、按支持能力的媒体会话、Codex 额度、天气、文本 Clipboard。
Agent 产品桥/UI 未纳入当前版本；GPU 其他厂商/混合GPU、媒体 provider 差异、在线故障分支等支持边界仍有未验证项。
天气未配置不联网；使用免费 Open-Meteo 服务的商业分发范围未复核，本候选不授权商业或公开发布。

验收限制：
G8-A 按用户决定 closed_with_unverified，不代表 P0–P7 全项、完整模块生命周期、24小时或系统恢复测试通过。
之前版本性能/截图不能自动算本候选包的证据。正式发布范围、跨版本升级、其他机器、长期运行与最终用户验收另办。
此 EXE/安装包未进行 Windows Authenticode 代码签名。遇到 Windows 安全警告不能当成已签名或可信发布。

第三方许可：安装目录 notices/ 含完整许可文本、dependency-notices.json 和 MPL 依赖的对应未修改发布源码包。
Lucide/Feather 完整声明见 notices/LUCIDE-LICENSE.txt；使用 blocks 图形不意味着拥有其独占商标。
