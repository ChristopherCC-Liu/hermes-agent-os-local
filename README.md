# Hermes Agent OS v0.1（本地实用版）

Hermes Agent OS 保留原有夜景写字楼、像素办公室、楼层、Agent Details、拖拽和缩放体验，同时把 Hermes 接入改为一个可运行的本地产品栈：浏览器只访问同源 Agent OS API，本地 BFF 再调用官方 Hermes API Server。

Demo 是离线展示，不调用 Hermes；Live 只显示官方 Hermes 返回的 session 和 run 状态。两种数据不会混合。

## 一键启动

需要 Node.js 20+。首次安装：

```bash
git clone https://github.com/ChristopherCC-Liu/hermes-agent-os-local.git
cd hermes-agent-os-local
npm install
npm start
```

macOS 也可以双击 `start.command`。它只在缺少 `node_modules` 时安装依赖，然后构建并启动前端与 BFF。

默认地址是 [http://127.0.0.1:4177](http://127.0.0.1:4177)。如果 4177 已占用，一键启动会依次尝试 4178–4187，并在终端打印实际地址。显式设置 `PORT` 时不会自动换端口。

开发模式：

```bash
npm run dev
```

## Demo 与 Live

| 模式 | 数据来源 | 会创建 Hermes session/run 吗 | 标识 |
| --- | --- | --- | --- |
| Demo | 浏览器内置示例组织 | 否 | `Demo` / `Demo org` |
| Live Hermes | 官方 Hermes API Server | 是 | `Hermes live` |
| Live 连接失败 | 无数据回退 | 否 | `Offline` 和明确错误 |

Demo 保留原有楼层、人物、派单和本地模拟交互。切换到 Live 时会立即移除 Demo campus；没有任何官方 session 时，Live 可以正确显示空组织，不会补造 Agent、任务、审批或 token usage。

## 连接官方 Hermes API Server

正在运行的服务必须实现官方契约，至少包括：

- `GET /health`、`GET /health/detailed`
- `GET /v1/capabilities`，且 `object` 必须是 `hermes.api_server.capabilities`
- `GET|POST /api/sessions`
- `POST /v1/runs`
- `GET /v1/runs/{run_id}` 和 `/events`
- `POST /v1/runs/{run_id}/approval` 和 `/stop`
- `GET /v1/skills`、`GET /v1/toolsets`

注意：`hermes serve` 的 dashboard/headless 服务不是这套官方 API Server。即使它的 `/api/status` 返回 200，Agent OS 也会拒绝把它标成 Live。

有两种配置方式。

### 方式一：Settings

在现有 UI 中打开 `Settings → Configure`，选择 `Live Hermes`，填写 API Server URL 和 `API_SERVER_KEY`，先测试再保存。

密钥只会从本机页面提交给同源 BFF，不写入 localStorage，也不会在之后重新返回或回填到浏览器。留空再次保存会保留已配置的服务端密钥。BFF 默认把配置写到：

- macOS：`~/Library/Application Support/hermes-agent-os/config.json`
- Linux：`$XDG_CONFIG_HOME/hermes-agent-os/config.json` 或 `~/.config/hermes-agent-os/config.json`

配置目录权限为 `0700`，文件权限为 `0600`。

### 方式二：服务端环境变量

```bash
HERMES_API_URL=http://127.0.0.1:8642 \
HERMES_API_KEY='your-api-server-key' \
npm start
```

兼容变量 `HERMES_URL` 和 `API_SERVER_KEY` 也可使用。不要使用 `VITE_` 前缀；那会把值暴露给浏览器构建。

## 实际架构

```text
Hermes Agent
  → 官方 Hermes API Server（Bearer auth）
  → 本地 Node BFF（127.0.0.1、固定上游白名单）
  → /api/os/* 归一化 HTTP / SSE
  → 现有 Grok 设计的楼宇与 Agent UI
```

BFF 只允许已审计的 Hermes 路由，不代理 `/api/status`、`/api/jobs` 或 `/api/analytics/usage`。Live 的 snapshot 来自 health、capabilities、sessions、skills 和 toolsets；run 创建后，`/v1/runs/{id}/events` SSE 是主要生命周期来源，状态查询只用于启动、对账和断线恢复。

浏览器侧同源 API：

- `GET /api/os/health`、`/capabilities`、`/snapshot`
- `POST /api/os/config`
- `GET|POST /api/os/sessions`
- `POST /api/os/sessions/:id/chat`
- `GET /api/os/runs/:id`、`/events`
- `POST /api/os/runs/:id/approval`、`/stop`

服务只绑定 loopback；写操作要求同源标记并拒绝跨域请求。上游 bearer key 不出现在 BFF 响应、前端 bundle 或浏览器持久化存储中。

## 构建与验证

```bash
npm run test:unit       # 合同、错误、密钥和状态同步
npm run test:e2e        # Demo / Live / blocked 全流程
npm run test:visual     # 与改造前 Playwright 截图比较
npm run build           # 生产构建
npm run check           # 上述自动化检查
npm run smoke:hermes    # 只读探测真实 127.0.0.1:8642
```

真实 smoke 不会创建 session 或 run，也不会消耗模型调用。它验证 health、detailed health、capabilities、现有 sessions、skills 和 toolsets；错误会以 `BLOCKED_WRONG_SERVICE`、`BLOCKED_AUTH`、`BLOCKED_TIMEOUT` 或其他明确状态退出。只有另行执行完整的真实派单、审批、停止和重启流程后，才可以声称真实 Hermes 端到端 smoke 已通过。

## 生产运行

`npm start` 会先执行 `npm run build`，再用同一个本地 Node 进程提供 `dist/` 和 `/api/os/*`。`npm run preview` 使用相同的本地生产服务器。Hermes 不可用时，产品 UI 仍会启动并显示 Offline，而不会退回伪造 Live 数据。
