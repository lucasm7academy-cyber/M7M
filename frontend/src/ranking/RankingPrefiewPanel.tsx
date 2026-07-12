import { useState, useEffect, type CSSProperties } from 'react'
import type { Ranking, RankingItem, OverlayInfo } from '../api'
import { api } from '../api'

interface Props {
  ranking: Ranking | null
  activeItem?: RankingItem | null
  overlays?: OverlayInfo[]
  onItemChange?: (patch: Partial<RankingItem>) => void
}

function ytThumb(url: string): string | null {
  if (!url) return null
  let id: string | null = null
  if (url.includes('shorts/')) id = url.split('shorts/')[1].split(/[?&]/)[0]
  else if (url.includes('v=')) id = url.split('v=')[1].split('&')[0]
  else if (url.includes('youtu.be/')) id = url.split('youtu.be/')[1].split(/[?&]/)[0]
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
}

const _W = 1080, _H = 1920, _VSCALE = 0.937

function framePlacement(nW: number, nH: number, videoY: number): CSSProperties {
  const isH = nW > nH
  let dispW: number, dispH: number
  if (!isH) {
    dispH = _VSCALE * _H
    dispW = dispH * (nW / nH)
  } else {
    dispW = _VSCALE * _W
    dispH = dispW * (nH / nW)
  }
  const wPct = (dispW / _W) * 100
  const hPct = (dispH / _H) * 100
  const yOff = (videoY / _H) * 100
  return {
    position: 'absolute',
    left: '50%',
    top: `calc(50% + ${yOff}%)`,
    width: `${wPct}%`,
    height: `${hPct}%`,
    transform: 'translate(-50%, -50%)',
  }
}

const TITLE_WIDTH_PCT    = 0.85 * 100                 // 85%
const TITLE_LEFT_PCT     = (1 - 0.85) / 2 * 100        // 7.5% (centralizado)
const TITLE_Y_DEFAULT    = 220
const TITLE_FONT_CQW     = (85 / 1080) * 100          // 7.87

const CORES_HEX: Record<string, string> = {
  Branco: '#FFFFFF', Amarelo: '#FFD400', Preto: '#000000',
  Vermelho: '#FF3B30', Verde: '#27E36B', Azul: '#3B82F6', Rosa: '#FF2D95',
}

const FONT_FAMILY: Record<string, string> = {
  'Padrão': 'tf-padrao', 'Manuscrita': 'tf-manuscrita',
  'Estilo 1': 'tf-estilo1', 'Estilo 2': 'tf-estilo2',
}

export default function RankingPreviewPanel({ ranking, activeItem, overlays, onItemChange }: Props) {
  const [frameReady, setFrameReady] = useState(false)
  const [aspect, setAspect] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => { setFrameReady(false); setAspect(null) }, [activeItem?.link, activeItem?.posicao])

  if (!ranking) return (
    <div className="card p-4 flex flex-col items-center justify-center min-h-[180px]">
      <span className="text-3xl mb-2">🏆</span>
      <p className="text-muted text-xs text-center">Selecione um ranking<br />para ver os detalhes</p>
    </div>
  )

  const statusColors: Record<string, string> = {
    editando: 'text-muted',
    na_fila: 'text-warn',
    processando: 'text-warn',
    enviando_drive: 'text-accent',
    concluido: 'text-success',
    erro: 'text-danger',
  }

  const thumb = activeItem?.link ? ytThumb(activeItem.link) : null
  const overlay = (overlays || []).find(o => o.id === ranking.overlay)

  // Title config
  const title = (ranking?.titulo_geral ?? '').trim()
  const hasTitle = title.length > 0
  const titleY = ranking?.title_y ?? TITLE_Y_DEFAULT
  const titleTopPct = (titleY / 1920) * 100
  const corLabel = ranking?.cor_titulo ?? 'Branco'
  const corHex = CORES_HEX[corLabel] ?? '#FFFFFF'
  const strokeRGBA = corLabel === 'Preto' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)'
  const fontFamily = FONT_FAMILY[ranking?.font ?? 'Padrão'] ?? 'tf-padrao'
  const temBorda = ranking?.titulo_borda ?? true
  const tituloShadow = temBorda
    ? `0 2px 4px ${strokeRGBA}, 0 0 2px ${strokeRGBA}, -1px -1px 0 ${strokeRGBA}, 1px 1px 0 ${strokeRGBA}`
    : 'none'

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold text-sm">{ranking.titulo_geral || 'Sem título'}</h2>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${statusColors[ranking.status] ? statusColors[ranking.status].replace('text-', 'bg-').concat('/20 ') + statusColors[ranking.status] : 'bg-card2 text-muted'}`}>
          {ranking.status?.replace('_', ' ')}
        </span>
      </div>

      {ranking.drive_url && (
        <a href={ranking.drive_url} target="_blank" rel="noopener noreferrer"
          className="block w-full text-center px-4 py-2 rounded-lg bg-success/20 border border-success/30 text-success text-sm font-medium hover:bg-success/30 transition-colors">
          ☁️ Abrir no Google Drive
        </a>
      )}

      {activeItem ? (
        <div className="flex flex-col items-center gap-2 pt-2">
          <div className="flex items-center justify-between w-full">
            <h3 className="text-xs font-semibold text-accent">Preview do Item #{activeItem.posicao}</h3>
            <span className="text-[10px] text-muted">Ajuste altura e máscara no painel à esquerda</span>
          </div>
          
          <div className="relative w-full aspect-[9/16] max-w-[280px] rounded-xl overflow-hidden border-2 border-border bg-black shadow-xl" style={{ containerType: 'inline-size' }}>
            {/* Fundo gradiente */}
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 to-zinc-900" />
            
            {/* Thumbnail temporária */}
            {thumb && (
              <img
                src={thumb}
                alt="thumb"
                className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300 ${frameReady ? 'opacity-0' : 'opacity-100'}`}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
            
            {/* Frame do vídeo ajustável */}
            <img
              src={activeItem.link ? api.frameUrl(activeItem.link) : ''}
              alt="frame"
              className={`object-cover pointer-events-none transition-opacity duration-500 rounded-lg ${!aspect ? 'border border-dashed border-muted' : ''}`}
              style={{
                ...(aspect ? framePlacement(aspect.w, aspect.h, activeItem.video_y ?? 0) : { position: 'absolute', inset: 0, width: '100%', height: '100%' }),
                opacity: frameReady && aspect ? 1 : 0,
              }}
              onLoad={e => {
                const im = e.currentTarget
                setAspect({ w: im.naturalWidth, h: im.naturalHeight })
                setFrameReady(true)
              }}
              onError={() => {
                setAspect({ w: 1080, h: 1920 })
                setFrameReady(true)
              }}
            />
            
            {/* Overlay da máscara */}
            {overlay && overlay.exists && (
              <img
                src={overlay.url}
                alt={`Overlay ${overlay.id}`}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
            
            {/* Título do Vídeo - igual à aba Video */}
            <div
              className="absolute text-center transition-all duration-150"
              style={{
                top:   `${titleTopPct}%`,
                left:  `${TITLE_LEFT_PCT}%`,
                width: `${TITLE_WIDTH_PCT}%`,
              }}
            >
              <p
                className={`font-bold leading-tight line-clamp-3 ${hasTitle ? '' : 'italic opacity-50'}`}
                style={{
                  color: hasTitle ? corHex : '#FFFFFF',
                  fontFamily,
                  fontSize: `${TITLE_FONT_CQW}cqw`,
                  textShadow: tituloShadow,
                }}
              >
                {hasTitle ? title : 'Digite um título…'}
              </p>
            </div>

            {/* Lista Lateral Fictícia para o Preview */}
            <div 
              className="absolute left-[6%] w-[80%] flex flex-col gap-3 pointer-events-none opacity-90 transition-all duration-150"
              style={{ top: `${(ranking.itens_y ?? 538) / 19.2}%` }}
            >
              {(() => {
                const isDesc = ranking.ordem !== 'crescente'
                const sorted = [...ranking.itens].sort((a,b) => isDesc ? b.posicao - a.posicao : a.posicao - b.posicao)
                const activeIdx = sorted.findIndex(x => x.posicao === activeItem.posicao)
                return sorted.map((it, i) => {
                  const isActive = i === activeIdx
                  const isFuture = i > activeIdx
                  const titulo = isFuture ? '' : (it.titulo_item || `Item ${it.posicao}`)
                  
                  return (
                    <div 
                      key={it.posicao} 
                      className={`text-left font-black ${isActive ? 'scale-105' : ''}`} 
                      style={{ 
                        fontSize: '4.5cqw', 
                        transformOrigin: 'left center',
                        textShadow: '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0px 2px 0 #000, 2px 0px 0 #000, 0px -2px 0 #000, -2px 0px 0 #000, 0px 4px 4px rgba(0,0,0,0.8)'
                      }}
                    >
                      <span className="text-white">{it.posicao}º</span>
                      {titulo && (
                        <span className={isActive ? 'text-[#00FF66]' : 'text-accent'}> {titulo}</span>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-4 flex flex-col items-center justify-center min-h-[180px] bg-card/40 border-dashed">
          <span className="text-xl mb-2">👁️</span>
          <p className="text-muted text-xs text-center">Selecione um item<br />para ver o preview dele</p>
        </div>
      )}
    </div>
  )
}