import type { WSContext } from "hono/ws";

export interface WsEvent {
  type:
    | "new-inbox-item"
    | "inbox-item-moved"
    | "deployment-status-change"
    | "ticket-changed"
    | "ping";
  data?: Record<string, unknown>;
  timestamp: string;
}

interface ClientState {
  lastPong: number;
}

export class WsHub {
  private clients = new Map<WSContext, ClientState>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly PING_INTERVAL_MS = 30_000;
  private static readonly PONG_TIMEOUT_MS = 60_000;

  addClient(ws: WSContext): void {
    this.clients.set(ws, { lastPong: Date.now() });
  }

  removeClient(ws: WSContext): void {
    this.clients.delete(ws);
  }

  recordPong(ws: WSContext): void {
    const state = this.clients.get(ws);
    if (state) {
      state.lastPong = Date.now();
    }
  }

  broadcast(event: WsEvent): void {
    const message = JSON.stringify(event);
    for (const [ws] of this.clients) {
      if (ws.readyState !== 1) {
        this.clients.delete(ws);
        continue;
      }
      try {
        ws.send(message);
      } catch {
        this.clients.delete(ws);
      }
    }
  }

  startPing(): void {
    if (this.pingInterval !== null) return;
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      for (const [ws, state] of this.clients) {
        if (now - state.lastPong > WsHub.PONG_TIMEOUT_MS) {
          this.clients.delete(ws);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          continue;
        }
        try {
          ws.send(
            JSON.stringify({ type: "ping", timestamp: new Date().toISOString() }),
          );
        } catch {
          this.clients.delete(ws);
        }
      }
    }, WsHub.PING_INTERVAL_MS);
  }

  stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  cleanup(): void {
    this.stopPing();
    for (const [ws] of this.clients) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  get size(): number {
    return this.clients.size;
  }
}

export const hub = new WsHub();
