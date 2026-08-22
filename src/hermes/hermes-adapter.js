// @ts-nocheck
import { fetchHermesSnapshot } from "../gateway.js";
import { projectHermesSnapshot } from "./org-engine.js";

function normalizeConfig(config = {}) {
  return {
    mode: config.mode === "live" ? "live" : "runtime",
    wsUrl: String(config.wsUrl || ""),
    baseUrl: String(config.baseUrl || config.wsUrl || ""),
    apiKey: String(config.apiKey || ""),
    mockEvents: config.mockEvents === true,
    reconnectMs: Math.max(1000, Number(config.reconnectMs) || 3500),
    pollMs: Math.max(2500, Number(config.pollMs) || 5000),
  };
}

class RuntimeHermesAdapter {
  constructor({ onConnection }) {
    this.onConnection = onConnection;
  }

  start() {
    this.onConnection?.("runtime");
  }

  stop() {}
}

class LiveHermesAdapter {
  constructor({ config, onEvent, onConnection }) {
    this.config = config;
    this.onEvent = onEvent;
    this.onConnection = onConnection;
    this.timer = null;
    this.stopped = true;
    this.inFlight = false;
  }

  start() {
    this.stopped = false;
    this.onConnection?.("connecting");
    this.tick();
    this.timer = window.setInterval(() => this.tick(), this.config.pollMs);
  }

  async tick() {
    if (this.stopped || this.inFlight) return;
    if (!this.config.baseUrl) {
      this.onConnection?.("offline");
      this.onEvent?.({ type: "org.error", message: "Hermes URL is missing." });
      return;
    }
    this.inFlight = true;
    try {
      const snapshot = await fetchHermesSnapshot({
        data: {
          baseUrl: this.config.baseUrl,
          apiKey: this.config.apiKey,
        },
      });
      if (this.stopped) return;
      if (!snapshot?.ok) {
        this.onConnection?.("offline");
        this.onEvent?.({
          type: "org.error",
          message: snapshot?.error || "Hermes snapshot failed.",
        });
        return;
      }
      const org = projectHermesSnapshot(snapshot);
      this.onConnection?.("live");
      this.onEvent?.({ type: "org.snapshot", org, pruneEmpty: true });
    } catch (error) {
      if (this.stopped) return;
      this.onConnection?.("offline");
      this.onEvent?.({
        type: "org.error",
        message: error instanceof Error ? error.message : "Hermes sync failed.",
      });
    } finally {
      this.inFlight = false;
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }
}

class WebSocketHermesAdapter {
  constructor({ config, onEvent, onConnection }) {
    this.config = config;
    this.onEvent = onEvent;
    this.onConnection = onConnection;
    this.socket = null;
    this.reconnectTimer = null;
    this.stopped = true;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped || !this.config.wsUrl) return;
    this.onConnection?.("connecting");
    try {
      this.socket = new WebSocket(this.config.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => this.onConnection?.("live"));
    this.socket.addEventListener("message", (message) => {
      try {
        const payload = JSON.parse(message.data);
        const events = Array.isArray(payload) ? payload : [payload];
        events.forEach((event) => this.onEvent?.(event));
      } catch (error) {
        console.warn("Hermes event ignored: invalid JSON payload.", error);
      }
    });
    this.socket.addEventListener("close", () => {
      this.onConnection?.("offline");
      this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => this.onConnection?.("offline"));
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.onConnection?.("offline");
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.config.reconnectMs);
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) this.socket.close();
    this.socket = null;
  }
}

export function createHermesAdapter({ config, onEvent, onConnection } = {}) {
  const resolved = normalizeConfig(config);
  if (resolved.mode === "live" && resolved.baseUrl && !String(resolved.baseUrl).startsWith("ws")) {
    return new LiveHermesAdapter({ config: resolved, onEvent, onConnection });
  }
  if (resolved.wsUrl) {
    return new WebSocketHermesAdapter({ config: resolved, onEvent, onConnection });
  }
  return new RuntimeHermesAdapter({ onConnection });
}
