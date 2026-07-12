import { useState, useEffect } from 'react'
import { ExternalLink, GripVertical, ArrowUp, ArrowDown } from 'lucide-react'
import type { RankingItem, OverlayInfo } from '../api'
import { api } from '../api'

interface Props {
  item: RankingItem
  pos: number
  total: number
  rankingId: string
  isActive?: boolean
  onClick?: () => void
  overlays?: OverlayInfo[]
  onItemChange: (pos: number, patch: Partial<RankingItem>, skipSave?: boolean) => void
  onRefresh: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

export default function RankingItemCard({ item, pos, total, rankingId, isActive, onClick, overlays, onItemChange, onRefresh, onMoveUp, onMoveDown }: Props) {
  const [linkDraft, setLinkDraft] = useState(item.link)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    setLinkDraft(item.link)
  }, [item.link])

  const handleLinkBlur = async () => {
    if (linkDraft === item.link) return
    setChecking(true)
    try {
      const updatedItem = await api.setRankingItem(rankingId, item.posicao, { link: linkDraft })
      if (updatedItem) {
        onItemChange(pos, updatedItem, true)
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e.message || String(e)
      alert(`Erro ao definir link do item ${item.posicao}: ${msg}`)
    }
    setChecking(false)
  }

  return (
    <div 
      className={`card p-3 space-y-2 cursor-pointer transition-colors ${isActive ? 'border-accent bg-accent/5 ring-1 ring-accent/30' : 'hover:border-muted'}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className="text-accent font-bold text-sm font-mono w-8">{item.posicao}º</span>
        <input
          className="flex-1 px-3 py-2 rounded-lg bg-card2 border border-border text-white text-sm outline-none focus:border-accent transition-colors"
          value={linkDraft}
          onChange={e => setLinkDraft(e.target.value)}
          onBlur={handleLinkBlur}
          placeholder="https://youtube.com/..."
          disabled={checking}
        />
        {item.link && (
          <button onClick={() => window.open(item.link, '_blank')}
            className="p-2 text-muted hover:text-accent transition-colors cursor-pointer" title="Abrir link">
            <ExternalLink size={14} />
          </button>
        )}
        <div className="flex flex-col gap-0.5">
          {onMoveUp && <button onClick={onMoveUp} className="p-1 text-muted hover:text-white cursor-pointer"><ArrowUp size={12} /></button>}
          {onMoveDown && <button onClick={onMoveDown} className="p-1 text-muted hover:text-white cursor-pointer"><ArrowDown size={12} /></button>}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted">Título do item</label>
        <input
          className="w-full px-3 py-2 rounded-lg bg-card2 border border-border text-white text-sm outline-none focus:border-accent transition-colors"
          value={item.titulo_item || ''}
          onChange={e => onItemChange(pos, { titulo_item: e.target.value })}
          placeholder="Ex: Jogada insana do Messi"
          disabled={checking}
        />
      </div>

      <div className="space-y-1 pt-1">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted">Recorte do vídeo (s)</label>
          <span className="text-xs font-mono text-accent font-medium">
            {item.trim_inicio_s.toFixed(1)}s — {item.trim_fim_s.toFixed(1)}s
          </span>
        </div>
        
        {(() => {
          const durMax = (item.duracao_original_s && item.duracao_original_s > 0) ? item.duracao_original_s : 180;
          return (
          <div className="relative h-6 flex items-center group">
            {/* Base track */}
            <div className="absolute w-full h-1.5 bg-card2 rounded-full overflow-hidden">
               {/* Highlight track */}
               <div 
                  className="absolute h-full bg-accent transition-all duration-75"
                  style={{
                    left: `${(item.trim_inicio_s / durMax) * 100}%`,
                    width: `${((item.trim_fim_s - item.trim_inicio_s) / durMax) * 100}%`
                  }}
               />
            </div>

            {/* Slider Start */}
            <input
              type="range"
              min={0}
              max={durMax}
              step={0.1}
              value={item.trim_inicio_s}
              onPointerDown={onClick}
              onChange={e => {
                const val = Number(e.target.value)
                if (val < item.trim_fim_s) onItemChange(pos, { trim_inicio_s: val })
              }}
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md cursor-grab active:cursor-grabbing"
            />
            {/* Slider End */}
            <input
              type="range"
              min={0}
              max={durMax}
              step={0.1}
              value={item.trim_fim_s}
              onPointerDown={onClick}
              onChange={e => {
                const val = Number(e.target.value)
                if (val > item.trim_inicio_s) onItemChange(pos, { trim_fim_s: val })
              }}
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md cursor-grab active:cursor-grabbing"
            />
          </div>
        );
        })()}
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted">Narração personalizada</label>
        <textarea
          className="w-full px-3 py-2 rounded-lg bg-card2 border border-border text-white text-sm outline-none focus:border-accent transition-colors resize-none"
          rows={2}
          value={item.narracao_texto || ''}
          onChange={e => onItemChange(pos, { narracao_texto: e.target.value })}
          placeholder="Deixe vazio para narração automática do título"
        />
      </div>

      {isActive && (
        <div className="pt-2 mt-2 border-t border-border/50 space-y-3 cursor-default" onClick={e => e.stopPropagation()}>
          {/* Posição do vídeo */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted">Posição do vídeo (Y)</label>
              <span className="text-accent text-[10px] font-mono">{item.video_y ?? 0}px</span>
            </div>
            <input
              type="range" min={-800} max={800}
              value={item.video_y ?? 0}
              onPointerDown={onClick}
              onChange={e => onItemChange(pos, { video_y: Number(e.target.value) })}
              className="w-full accent-accent cursor-pointer"
            />
          </div>



        </div>
      )}
    </div>
  )
}