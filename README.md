# Hermes Agent OS v0.1

Night-campus glass tower + Claude-cream interiors. Vanilla JS + Canvas 2D.

This checkout is the **local web app**. It opens a **demo organization** and **does not call Grok / xAI / SpaceX APIs**, so it does not consume Grok usage.

Live mode only talks to **your** Hermes API server (`http://127.0.0.1:8642` by default).

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

`npm run dev` 会先自动 assemble 源文件，不需要额外步骤。

## What you get without Hermes

First load shows a 6-floor demo org (Support spawns Marketing / SEO / Engineering / Review / People). You can:

- Pan, pinch-zoom, and look inside floors
- Click floors, pods, desks
- Dispatch **simulated** tasks (local draft only — **no API, no Grok usage**)
- Open Agents / Tasks / Approvals / Analytics / Settings

## Connect a real Hermes server

1. Start Hermes on this computer (API default `http://127.0.0.1:8642`).
2. In the app: **Settings → Configure**, choose **Live Hermes**.
3. URL: `http://127.0.0.1:8642`
4. Paste `API_SERVER_KEY` if your server requires it.
5. **Test connection** → **Save**.

Localhost is proxied by Vite (`/hermes-proxy`) so the browser does not hit CORS. Other port:

```bash
HERMES_URL=http://127.0.0.1:YOUR_PORT npm run dev
```

Remote / tunneled Hermes URLs are fetched directly. That path uses **your Hermes**, not Grok.

## Usage / billing

| Action | Consumes Grok usage? |
| --- | --- |
| Open the demo org, click around, dispatch simulated tasks | No |
| Connect Live Hermes to your own server | No (Hermes’ own cost, if any) |
| Old “Start local runtime” that called grok-4.5 | **Removed** |

## Project layout

```text
index.html              App shell
src/main.js             Mounts the OS
src/gateway.js          Browser Hermes client (no xAI)
src/hermes/             Office renderer, store, UI
src/hermes/packed/      Split sources (assembled on npm run dev)
scripts/assemble.mjs    Joins packed files automatically
public/favicon.svg
```

## Production build

```bash
npm run build
npm run preview
```
