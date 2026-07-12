import { useEffect, useState } from 'react'
import type { Ranking } from '../api'

interface Props {
  ranking: Ranking | null
  processing: boolean
}

export default function RankingProgressPanel({ ranking, processing }: Props) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!processing || !ranking?.started_at) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [processing, ranking?.started_at])

  if (!ranking || (ranking.status === 'editando' || ranking.status === 'concluido')) return null

  const isActive = processing && ranking.started_at && !ranking.finished_at
  const elapsedMs = isActive ? now - ranking.started_at : (ranking.elapsed_ms ?? null)

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-sm">Progresso do Ranking</h2>
        {elapsedMs !== null && (
          <span className={`text-xs font-mono ${isActive ? 'text-warn' : 'text-success'}`}>
            ⏱ {fmtElapsed(elapsedMs)}
          </span>
        )}
        {processing && (
          <span className="flex items-center gap-1.5 text-warn text-xs">
            <span className="w-2 h-2 rounded-full bg-warn animate-pulse-dot" />
            Processando
          </span>
        )}
      </div>

      <div className="h-2 bg-card2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            ranking.status === 'erro' ? 'bg-danger' :
            ranking.status === 'concluido' ? 'bg-success' : 'bg-warn'
          } ${isActive ? 'animate-pulse' : ''}`}
          style={{ width: `${ranking.progress != null ? ranking.progress * 100 : 0}%` }}
        />
      </div>

      <p className="text-xs text-muted">
        {ranking.status === 'na_fila' && 'Aguardando processamento…'}
        {isActive && `Processando item ${ranking.atual ?? '?'} de ${ranking.total ?? ranking.quantidade}`}
        {ranking.status === 'concluido' && '✅ Ranking concluído!'}
        {ranking.status === 'erro' && `❌ Erro: ${ranking.upload_error || 'Erro desconhecido'}`}
      </p>
    </div>
  )
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h${m.toString().padStart(2, '0')}m`
}