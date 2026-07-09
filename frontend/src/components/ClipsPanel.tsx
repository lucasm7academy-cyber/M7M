import { Download, Film } from 'lucide-react'
import type { ClipFile } from '../api'

interface Props {
  clips:     ClipFile[]
  onRefresh: () => void
}

export default function ClipsPanel({ clips, onRefresh }: Props) {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-sm flex items-center gap-2">
          <Film size={14} className="text-accent" />
          Clips prontos
          {clips.length > 0 && (
            <span className="px-2 py-0.5 bg-success/20 text-success text-xs rounded-full">
              {clips.length}
            </span>
          )}
        </h2>
        <button
          onClick={onRefresh}
          className="text-xs text-muted hover:text-white transition-colors cursor-pointer"
        >
          Atualizar
        </button>
      </div>

      {clips.length === 0 ? (
        <p className="text-muted text-xs text-center py-6">
          Os vídeos processados aparecerão aqui
        </p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {clips.map(clip => (
            <div
              key={clip.filename}
              className="flex items-center justify-between bg-card2 rounded-lg px-3 py-2.5 border border-border"
            >
              <div className="min-w-0">
                <p className="text-white text-xs font-medium truncate">{clip.filename}</p>
                <p className="text-muted text-xs">{clip.size_mb} MB</p>
              </div>
              <a
                href={clip.url}
                download={clip.filename}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-accent/20 hover:bg-accent/40 text-accent text-xs rounded-lg transition-colors ml-3 shrink-0"
              >
                <Download size={11} />
                Baixar
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
