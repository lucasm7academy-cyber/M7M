import { Trash2, ExternalLink, RefreshCw, Cloud, CloudOff, Upload, Play, XCircle } from 'lucide-react'
import type { VideoItem } from '../api'
import { api } from '../api'

const STATUS_EMOJI: Record<string, string> = {
  editando:       '📝',
  na_fila:        '⏳',
  baixando:       '📥',
  convertendo:    '🔄',
  exportando:     '💾',
  legendando:     '💬',
  narrando:       '🎙️',
  processando:    '⚙️',
  enviando_drive: '☁️',
  concluido:      '✅',
  erro:           '❌',
  erro_upload:    '⚠️',
}

const STATUS_COLOR: Record<string, string> = {
  editando:       'text-muted',
  na_fila:        'text-muted',
  baixando:       'text-accent',
  convertendo:    'text-warn',
  exportando:     'text-warn',
  legendando:     'text-warn',
  narrando:       'text-warn',
  processando:    'text-warn',
  enviando_drive: 'text-accent',
  concluido:      'text-success',
  erro:           'text-danger',
  erro_upload:    'text-danger',
}

interface Props {
  videos:      VideoItem[]
  selectedIdx: number | null
  onSelect:    (idx: number) => void
  onDelete:    (idx: number) => void
  onRefresh:   () => void
}

export default function VideoQueue({ videos, selectedIdx, onSelect, onDelete, onRefresh }: Props) {
  const handleRetry = async (idx: number) => {
    try {
      await api.retryUpload(idx)
      onRefresh()
    } catch (e) {
      alert(`Retry falhou: ${e}`)
    }
  }
  const handleDeleteLocal = async (idx: number) => {
    if (!confirm('Apagar arquivo local? O vídeo continua na fila.')) return
    try {
      await api.deleteLocal(idx)
      onRefresh()
    } catch (e) {
      alert(`Erro: ${e}`)
    }
  }
  const handleQueue = async (idx: number) => {
    try {
      await api.queueVideo(idx)
      onRefresh()
    } catch (e) {
      alert(`Erro ao colocar na fila: ${e}`)
    }
  }
  const handleDequeue = async (idx: number) => {
    try {
      await api.dequeueVideo(idx)
      onRefresh()
    } catch (e) {
      alert(`Erro ao tirar da fila: ${e}`)
    }
  }
  return (
    <div className="flex-1 card flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-white font-semibold text-sm">
          Fila de vídeos
          {videos.length > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-accent/20 text-accent text-xs rounded-full">
              {videos.length}
            </span>
          )}
        </span>
        <button
          onClick={onRefresh}
          className="text-muted hover:text-white transition-colors cursor-pointer"
          title="Atualizar"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center">
            <span className="text-4xl mb-3">📭</span>
            <p className="text-muted text-sm">Nenhum vídeo na fila.</p>
            <p className="text-muted text-xs mt-1">Adicione uma URL ou busque vídeos virais.</p>
          </div>
        ) : (
          videos.map((v, i) => {
            const selected = i === selectedIdx
            const statusKey = v.status || 'na_fila'
            return (
              <div
                key={i}
                onClick={() => onSelect(i)}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                  selected
                    ? 'bg-card2 border-accent'
                    : 'bg-transparent border-transparent hover:bg-card2 hover:border-border'
                }`}
              >
                {/* Número */}
                <span className="text-muted text-xs font-mono w-5 shrink-0 text-right">
                  {String(i + 1).padStart(2, '0')}
                </span>

                {/* Emoji status */}
                <span className="text-base shrink-0">{STATUS_EMOJI[statusKey] ?? '❓'}</span>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate flex items-center gap-1.5">
                    {v.title || 'Sem título'}
                    {v.drive_url && (
                      <Cloud size={12} className="text-success shrink-0" />
                    )}
                  </p>
                  <p className={`text-xs truncate ${STATUS_COLOR[statusKey] ?? 'text-muted'}`}>
                    {statusKey.replace('_', ' ')}
                    {v.upload_error ? ` · ${v.upload_error.slice(0, 40)}` : ` · ${v.url.slice(0, 35)}…`}
                  </p>
                </div>

                {/* Ações */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {v.drive_url && (
                    <button
                      onClick={e => { e.stopPropagation(); window.open(v.drive_url, '_blank') }}
                      className="p-1 text-success hover:text-white transition-colors"
                      title="Abrir no Google Drive"
                    >
                      <Cloud size={13} />
                    </button>
                  )}
                  {statusKey === 'editando' && !v.processado && (
                    <button
                      onClick={e => { e.stopPropagation(); handleQueue(i) }}
                      className="p-1 text-accent hover:text-white transition-colors"
                      title="Adicionar à fila de processamento"
                    >
                      <Play size={13} />
                    </button>
                  )}
                  {statusKey === 'na_fila' && !v.processado && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDequeue(i) }}
                      className="p-1 text-warn hover:text-white transition-colors"
                      title="Remover da fila de processamento"
                    >
                      <XCircle size={13} />
                    </button>
                  )}
                  {statusKey === 'erro_upload' && (
                    <>
                      <button
                        onClick={e => { e.stopPropagation(); handleRetry(i) }}
                        className="p-1 text-accent hover:text-white transition-colors"
                        title="Tentar enviar para Drive novamente"
                      >
                        <Upload size={13} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteLocal(i) }}
                        className="p-1 text-warn hover:text-white transition-colors"
                        title="Apagar arquivo local (libera disco)"
                      >
                        <CloudOff size={13} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); window.open(v.url, '_blank') }}
                    className="p-1 text-muted hover:text-accent transition-colors"
                    title="Abrir no YouTube"
                  >
                    <ExternalLink size={13} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(i) }}
                    className="p-1 text-muted hover:text-danger transition-colors"
                    title="Excluir da fila"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
