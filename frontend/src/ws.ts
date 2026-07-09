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

type Handler = (e: WsEvent) => void

class ProgressSocket {
  private ws:      WebSocket | null = null
  private handler: Handler | null   = null

  connect(onEvent: Handler) {
    this.handler = onEvent
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    this.ws = new WebSocket(`${proto}://${window.location.host}/ws/progress`)
    this.ws.onmessage = (msg) => {
      try { onEvent(JSON.parse(msg.data) as WsEvent) } catch { /* ignora frames inválidos */ }
    }
    this.ws.onclose = () => {
      // reconnect after 2s
      setTimeout(() => { if (this.handler) this.connect(this.handler) }, 2000)
    }
  }

  disconnect() {
    this.handler = null
    this.ws?.close()
  }
}

export const progressSocket = new ProgressSocket()
