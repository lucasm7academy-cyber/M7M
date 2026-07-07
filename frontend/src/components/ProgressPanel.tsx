import { useEffect, useState } from 'react'
import type { VideoItem } from '../api'
import type { WsEvent } from '../ws'

const STATUS_LABEL: Record<string, string> = {
  na_fila:     'Na fila',
  baixando:    'Baixando…',
  convertendo: 'Convertendo…',
  exportando:  'Exportando…',
  processando: 'Processando…',
  concluido:   'Concluído',
  erro:        'Erro',
}

const STATUS_COLOR: Record<string, string> = {
  na_fila:     'bg-muted/30',
  baixando:    'bg-accent',
  convertendo: 'bg-warn',
  exportando:  'bg-warn',
  processando: 'bg-warn',
  concluido:   'bg-success',
  erro:        'bg-danger',
}

const STEP_ORDER = ['na_fila','baixando','convertendo','exportando','concluido']

function stepPercent(status: string): number {
  const idx = STEP_ORDER.indexOf(status)
  if (idx < 0) return status === 'erro' ? 100 : 0
  return Math.round((idx / (STEP_ORDER.length - 1)) * 100)
}

/**
 * ETA pessimista mas sincera: `decorrido * (1 - prog) / prog`.
 * Retorna null se progresso muito baixo (estimativa instável) ou já pronto.
 */
function etaMs(elapsedMs: number, progress: number): number | null {
  if (progress >= 0.999) return 0
  if (progress < 0.03)   return null   // ainda muito cedo para estimar
  return Math.max(0, (elapsedMs * (1 - progress)) / progress)
}

/** Formata "0:42" para <60s, "1:23" depois, "1h12m" se >=1h. */
function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 3600) {
    const m   = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h${m.toString().padStart(2, '0')}m`
}

/**
 * Hook que retorna o "tempo agora" em ms, atualizando a cada 1s,
 * mas só enquanto `active=true`. Evita re-renders inúteis quando ocioso.
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

interface Props {
  videos:         VideoItem[]
  processing:     boolean
  lastEvent:      WsEvent | null
  batchStartedAt: number | null
  batchElapsedMs: number | null
}

export default function ProgressPanel({ videos, processing, batchStartedAt, batchElapsedMs }: Props) {
  const pending = videos.filter(v => !v.processado).length
  const done    = videos.filter(v => v.processado).length

  // Tick global enquanto há lote rodando OU qualquer vídeo ativo
  const anyActive = videos.some(v => v.started_at && !v.finished_at)
  const now = useNow(processing || anyActive)

  // Cronômetro global do lote
  const batchLive   = batchStartedAt ? now - batchStartedAt : null
  const batchShown  = batchLive ?? batchElapsedMs   // ao vivo > último finalizado

  // ETA do lote: usa média dos vídeos já concluídos × restantes,
  // mais a ETA do vídeo em curso (se houver).
  const finishedVideos = videos.filter(v => v.processado && v.elapsed_ms)
  const avgPerVideoMs  = finishedVideos.length
    ? finishedVideos.reduce((s, v) => s + (v.elapsed_ms ?? 0), 0) / finishedVideos.length
    : null

  let batchEta: number | null = null
  if (processing) {
    const ativo = videos.find(v => v.started_at && !v.finished_at)
    const restantes = videos.filter(v => !v.processado && !(v.started_at && !v.finished_at)).length

    let etaAtivo = 0
    if (ativo && ativo.started_at) {
      const decorrido = now - ativo.started_at
      const prog      = ativo.progress ?? 0
      etaAtivo = etaMs(decorrido, prog) ?? (avgPerVideoMs ? Math.max(0, avgPerVideoMs - decorrido) : 0)
    }
    if (avgPerVideoMs !== null || etaAtivo > 0) {
      batchEta = etaAtivo + restantes * (avgPerVideoMs ?? etaAtivo)
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-sm">Progresso</h2>
        <div className="flex items-center gap-3">
          {batchShown !== null && (
            <span className={`text-xs font-mono ${batchLive !== null ? 'text-warn' : 'text-success'}`}>
              ⏱ {fmtElapsed(batchShown)}
            </span>
          )}
          {batchEta !== null && batchEta > 0 && (
            <span className="text-xs font-mono text-accent">
              ⏳ resta {fmtElapsed(batchEta)}
            </span>
          )}
          {processing && (
            <span className="flex items-center gap-1.5 text-warn text-xs">
              <span className="w-2 h-2 rounded-full bg-warn animate-pulse-dot" />
              Processando
            </span>
          )}
        </div>
      </div>

      {/* Resumo */}
      {videos.length > 0 && (
        <div className="flex gap-3 text-xs">
          <span className="text-muted">Na fila: <strong className="text-white">{pending}</strong></span>
          <span className="text-muted">Clips finalizados: <strong className="text-success">{done}</strong></span>
          <span className="text-muted">Total: <strong className="text-white">{videos.length}</strong></span>
        </div>
      )}

      {/* Barras */}
      <div className="space-y-2">
        {videos.length === 0 ? (
          <p className="text-muted text-xs text-center py-4">Nenhum vídeo na fila</p>
        ) : (
          videos.map((v, i) => {
            // Prefere progresso granular (download/export) sobre degraus de fase
            const pct      = v.progress !== undefined
              ? Math.round(v.progress * 100)
              : stepPercent(v.status)
            const color    = STATUS_COLOR[v.status] ?? 'bg-muted/30'
            const label    = STATUS_LABEL[v.status] ?? v.status
            const isActive = processing && !v.processado && v.status !== 'na_fila'

            // Cronômetro por vídeo:
            //  - ao vivo: started_at definido, ainda não terminou
            //  - final:   elapsed_ms gravado
            const liveMs   = v.started_at && !v.finished_at ? now - v.started_at : null
            const showMs   = liveMs ?? v.elapsed_ms ?? null
            const timerCol = liveMs !== null
              ? 'text-warn'
              : v.status === 'concluido'
                ? 'text-success'
                : v.status === 'erro'
                  ? 'text-danger'
                  : 'text-muted'

            // ETA por vídeo: só faz sentido enquanto está rodando
            const itemEta = (isActive && liveMs !== null && v.progress !== undefined)
              ? etaMs(liveMs, v.progress)
              : null

            return (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-white truncate max-w-[200px]">{v.title || `Vídeo ${i+1}`}</span>
                  <span className="flex items-center gap-2">
                    {showMs !== null && (
                      <span className={`font-mono ${timerCol}`}>
                        {fmtElapsed(showMs)}
                      </span>
                    )}
                    {itemEta !== null && itemEta > 0 && (
                      <span className="font-mono text-accent">
                        / -{fmtElapsed(itemEta)}
                      </span>
                    )}
                    <span className={`${v.status === 'concluido' ? 'text-success' : v.status === 'erro' ? 'text-danger' : 'text-muted'}`}>
                      {label}
                    </span>
                  </span>
                </div>
                <div className="h-1.5 bg-card2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${color} ${isActive ? 'animate-pulse' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
