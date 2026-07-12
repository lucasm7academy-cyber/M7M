// WebSocket client — connects to /ws/progress

export type WsEvent =
  | { type: 'batch_started'; at: number; total: number }
  | { type: 'started';       idx: number; at: number; id?: string }
  | { type: 'status';        idx: number; value: string; at?: number; id?: string }
  | { type: 'progress';      idx: number; phase: string; fraction: number; at: number; id?: string }
  | { type: 'done';          idx: number; path: string; started_at: number; finished_at: number; elapsed_ms: number; id?: string }
  | { type: 'error';         idx: number; message: string; started_at: number; finished_at: number; elapsed_ms: number; id?: string }
  | { type: 'all_done';      total: number; started_at: number; finished_at: number; elapsed_ms: number }
  | { type: 'uploading';     idx: number; id?: string }
  | { type: 'uploaded';      idx: number; drive_id: string; drive_url: string; id?: string }
  | { type: 'cleaned';       idx: number; removed: string[]; id?: string }
  | { type: 'upload_error';  idx: number; error: string; id?: string }
  // Ranking events
  | { type: 'ranking_started';   id: string; at: number }
  | { type: 'ranking_status';    id: string; value: string; at?: number }
  | { type: 'ranking_progress';  id: string; fase: string; atual: number; total: number; at?: number }
  | { type: 'ranking_done';      id: string; path: string; elapsed_ms: number }
  | { type: 'ranking_error';     id: string; message: string; elapsed_ms: number }
  | { type: 'ranking_thumb';     id: string; pos: number; blob: string }

type Handler = (e: WsEvent) => void

class ProgressSocket {
  private ws:      WebSocket | null = null
  private handlers = new Set<Handler>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  connect(onEvent: Handler) {
    this.handlers.add(onEvent)
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this._connectWs()
    }
    return () => {
      this.handlers.delete(onEvent)
      if (this.handlers.size === 0) {
        this.ws?.close()
        this.ws = null
      }
    }
  }

  private _connectWs() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    this.ws = new WebSocket(`${proto}://${window.location.host}/ws/progress`)
    this.ws.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as WsEvent
        this.handlers.forEach(h => h(ev))
      } catch { /* ignora frames inválidos */ }
    }
    this.ws.onclose = () => {
      if (this.handlers.size > 0) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = setTimeout(() => this._connectWs(), 2000)
      }
    }
  }

  disconnect() {
    // Para manter compatibilidade onde for chamado sem parâmetros, limpa tudo.
    this.handlers.clear()
    this.ws?.close()
    this.ws = null
  }
}

export const progressSocket = new ProgressSocket()
