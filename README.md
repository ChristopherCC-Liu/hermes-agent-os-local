# Hermes Agent OS v0.1（实用版）

夜景写字楼 + Claude 米色办公室。点人物看任务，Agent Details 嵌在楼里。

这是 **本地实用版**：打开就是 demo 组织，**不会调用 Grok / xAI / SpaceX**，不消耗 Grok usage。

Live 模式只连接 **你自己的 Hermes API**（默认 `http://127.0.0.1:8642`）。

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

`npm run dev` 会先自动 assemble 源文件。

## 没接 Hermes 时能做什么

第一次打开是 6 层 demo 组织（Support 拉起 Marketing / SEO / Engineering / Annex / HR）：

- 拖动、滚轮 / 双指缩放
- 点人物看当前任务和 Agent Details
- Dispatch Task 走本地模拟（**不打 API，不消耗 Grok**）
- Agents / Tasks / Approvals / Analytics / Settings

## 接真实 Hermes

1. 本机启动 Hermes（API 默认 `http://127.0.0.1:8642`）
2. 应用里 **Settings → Configure**，选 **Live Hermes**
3. URL 填 `http://127.0.0.1:8642`
4. 如需鉴权，粘贴 `API_SERVER_KEY`
5. **Test connection** → **Save**

本机地址由 Vite 代理 `/hermes-proxy`，浏览器不会撞 CORS。换端口：

```bash
HERMES_URL=http://127.0.0.1:YOUR_PORT npm run dev
```

远程 / 隧道 Hermes 地址会直连，走的是 **你的 Hermes**，不是 Grok。

## Usage

| 操作 | 消耗 Grok usage？ |
| --- | --- |
| 打开 demo、点人物、模拟派任务 | 否 |
| Live Hermes 连你自己的服务器 | 否（Hermes 自己的成本另算） |
| 旧的 “Start local runtime” 调 grok-4.5 | **已删除** |

## 生产构建

```bash
npm run build
npm run preview
```
