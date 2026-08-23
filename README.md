# Hermes Agent OS v0.1（深色样板）

夜景写字楼与像素办公室的确定性本地样板。打开后始终显示带 `Demo` 标识的模拟组织；样板本身不会把 fixture 标成 LIVE，也不直接读取 Hermes 私有接口。

## 本地运行

需要 [Node.js 20+](https://nodejs.org/)。

```bash
git clone https://github.com/ChristopherCC-Liu/hermes-agent-os-local.git
cd hermes-agent-os-local
npm install
npm run dev
```

浏览器打开 [http://127.0.0.1:4177](http://127.0.0.1:4177)。

macOS 也可双击 `start.command`。

`npm run dev` 会先自动 assemble 已打包的界面源文件。

## 样板功能

- 拖动、滚轮 / 双指缩放
- 点人物看当前任务和 Agent Details
- 在本地模拟 Dispatch Task、模块与座位变化
- Agents / Tasks / Approvals / Analytics / Settings
- 在矮桌面窗口中保持办公室舞台可见

## 连接本机 Hermes

真实数据由已安装的 Hermes host 插件负责，深色样板只做明确的页面交接：

1. 启动本机 Hermes dashboard：`http://127.0.0.1:9119`。
2. 在 dashboard 完成登录。
3. 在样板中打开 **Settings → Open host**，再在弹窗中点击 **Connect Hermes**。
4. 浏览器进入 `http://127.0.0.1:9119/hermes-agent-os/`，由 host 同源会话读取 snapshot 与 events。

连接界面不收集凭据，也不通过 4177 的代理伪造 LIVE。若 host 证据不足，插件应显示对应的 `CONNECTING / STALE / OFFLINE / UNAVAILABLE`，而不是把样板数据当成真实状态。

## 生产构建

```bash
npm run build
npm run preview
```
