import { Mic2 } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { api, type VideoItem, type OverlayInfo, type Tarja } from '../api'

const TARJA_DEFAULT: Tarja = { ativo: false, x: 0.35, y: 0.45, w: 0.30, h: 0.07, texto: '' }

function ytThumb(url: string): string | null {
  let id: string | null = null
  if (url.includes('shorts/')) id = url.split('shorts/')[1].split(/[?&]/)[0]
  else if (url.includes('v=')) id = url.split('v=')[1].split('&')[0]
  else if (url.includes('youtu.be/')) id = url.split('youtu.be/')[1].split(/[?&]/)[0]
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Espelha to_vertical() do backend (config.py → VIDEO_SCALE_RATIO_VERTICAL = 0.90)
const _W = 1080, _H = 1920, _VSCALE = 0.937

function framePlacement(nW: number, nH: number, videoY: number): CSSProperties {
  const isH = nW > nH
  let dispW: number, dispH: number, left: number, top: number
  if (!isH) {
    // Portrait: scale height to VSCALE of phone, width auto
    dispH = _VSCALE * _H
    dispW = dispH * (nW / nH)
    top  = (_H - dispH) / 2 + videoY
    left = (_W - dispW) / 2
  } else {
    // Landscape: scale width to VSCALE of phone, height auto
    dispW = _VSCALE * _W
    dispH = dispW * (nH / nW)
    left = (_W - dispW) / 2
    top  = (_H - dispH) / 2 + videoY
  }
  return {
    position: 'absolute',
    left:   `${(left / _W) * 100}%`,
    top:    `${(top / _H) * 100}%`,
    width:  `${(dispW / _W) * 100}%`,
    height: `${(dispH / _H) * 100}%`,
  }
}

// Constantes-espelho do backend (backend/config.py):
//   WIDTH=1080, HEIGHT=1920 → aspecto 9:16
//   TITLE_WIDTH_RATIO = 0.85
const TITLE_WIDTH_PCT    = 0.85 * 100                 // 85%
const TITLE_LEFT_PCT     = (1 - 0.85) / 2 * 100        // 7.5% (centralizado)
const TITLE_Y_DEFAULT    = 330
// Espelha backend TITLE_FONT_SIZE (56) sobre WIDTH (1080) → ~5.2% da largura.
// Usa cqw (% da largura do "telefone") pra bater proporção exata com o vídeo.
const TITLE_FONT_CQW     = (56 / 1080) * 100          // 5.185

// Espelho de CORES_TITULO (backend/config.py)
const CORES_HEX: Record<string, string> = {
  Branco: '#FFFFFF', Amarelo: '#FFD400', Preto: '#000000',
  Vermelho: '#FF3B30', Verde: '#27E36B', Azul: '#3B82F6', Rosa: '#FF2D95',
}

// Fonte do título → família @font-face (index.css)
const FONT_FAMILY: Record<string, string> = {
  'Padrão': 'tf-padrao', 'Manuscrita': 'tf-manuscrita',
  'Estilo 1': 'tf-estilo1', 'Estilo 2': 'tf-estilo2',
}

interface Props {
  video:   VideoItem | null
  overlay: OverlayInfo | undefined
  onChange?: (patch: { tarja: Tarja }) => void
}

// Amostra visual da legenda por estilo (máx 3 palavras, linha única).
function renderLegendaSample(estilo: string) {
  const sombra = '0 1px 2px rgba(0,0,0,0.95), 0 0 1px rgba(0,0,0,1)'
  const base: CSSProperties = {
    fontSize: 'clamp(8px, 3.6cqw, 15px)',
    fontWeight: 800,
    whiteSpace: 'nowrap',
    textShadow: sombra,
    lineHeight: 1,
  }

  if (estilo === 'POP_BRANCO') {
    return <span style={{ ...base, color: '#fff' }}>JOGADA</span>
  }

  if (estilo === 'BOX_HORMOZI') {
    return (
      <span style={{
        ...base, color: '#000', background: '#fff',
        padding: '2px 6px', borderRadius: 4, textShadow: 'none',
      }}>ESSA JOGADA INSANA</span>
    )
  }

  // AMARELO_CLASSICO e NEON_VERDE: 3 palavras, a do meio destacada
  const destaque = estilo === 'NEON_VERDE'
    ? { color: '#fff', textShadow: '0 0 6px #27E36B, 0 0 3px #27E36B, ' + sombra }
    : { color: '#FFD400', textShadow: sombra }

  return (
    <span style={{ ...base, color: '#fff' }}>
      ESSA <span style={destaque}>JOGADA</span> INSANA
    </span>
  )
}

export default function PreviewPanel({ video, overlay, onChange }: Props) {
  const phoneRef = useRef<HTMLDivElement>(null)
  const dragRef  = useRef<null | { mode: 'move' | 'resize'; sx: number; sy: number; orig: Tarja }>(null)
  const liveRef  = useRef<Tarja | null>(null)
  const [liveTarja, setLiveTarjaState] = useState<Tarja | null>(null)
  const [frameReady, setFrameReady] = useState(false)
  const [aspect, setAspect] = useState<{ w: number; h: number } | null>(null)

  function setLive(t: Tarja | null) { liveRef.current = t; setLiveTarjaState(t) }

  // Reseta o frame real ao trocar de vídeo
  useEffect(() => { setFrameReady(false); setAspect(null) }, [video?.url])

  // Drag/resize da tarja (listeners globais enquanto arrasta)
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current
      const rect = phoneRef.current?.getBoundingClientRect()
      if (!d || !rect) return
      const dx = (e.clientX - d.sx) / rect.width
      const dy = (e.clientY - d.sy) / rect.height
      if (d.mode === 'move') {
        setLive({ ...d.orig,
          x: clamp(d.orig.x + dx, 0, 1 - d.orig.w),
          y: clamp(d.orig.y + dy, 0, 1 - d.orig.h) })
      } else {
        setLive({ ...d.orig,
          w: clamp(d.orig.w + dx, 0.05, 1 - d.orig.x),
          h: clamp(d.orig.h + dy, 0.02, 1 - d.orig.y) })
      }
    }
    function onUp() {
      if (!dragRef.current) return
      dragRef.current = null
      const final = liveRef.current
      setLive(null)
      if (final && onChange) onChange({ tarja: final })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onChange])

  if (!video) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 flex flex-col items-center justify-center min-h-[180px]">
        <span className="text-3xl mb-2">📱</span>
        <p className="text-muted text-xs text-center">Selecione um vídeo<br />para ver o preview</p>
      </div>
    )
  }

  const title = (video.title ?? '').trim()
  const hasTitle = title.length > 0

  // Altura e cor reais (espelham o backend)
  const titleY      = video.title_y ?? TITLE_Y_DEFAULT
  const titleTopPct = (titleY / 1920) * 100
  const corLabel    = video.cor_titulo ?? 'Branco'
  const corHex      = CORES_HEX[corLabel] ?? '#FFFFFF'
  // Contorno: branco se o texto for preto, senão preto (igual ao backend)
  const strokeRGBA  = corLabel === 'Preto' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.9)'
  const fontFamily  = FONT_FAMILY[video.font ?? 'Padrão'] ?? 'tf-padrao'
  const temBorda    = video.titulo_borda ?? true
  const tituloShadow = temBorda
    ? `0 2px 4px ${strokeRGBA}, 0 0 2px ${strokeRGBA}, -1px -1px 0 ${strokeRGBA}, 1px 1px 0 ${strokeRGBA}`
    : 'none'

  const tarja = liveTarja ?? video.tarja ?? TARJA_DEFAULT
  const thumb = ytThumb(video.url)

  function startDrag(mode: 'move' | 'resize', e: ReactMouseEvent) {
    e.preventDefault(); e.stopPropagation()
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, orig: tarja }
    setLive(tarja)
  }

  return (
    <div className="bg-card rounded-xl border border-border p-3 flex flex-col items-center gap-2">
      <h2 className="text-white font-semibold text-sm self-start">Preview</h2>

      {/* "Telefone" — proporção 9:16 fixa */}
      <div
        ref={phoneRef}
        className="relative w-full aspect-[9/16] rounded-2xl overflow-hidden border-2 border-border bg-black shadow-xl"
        style={{ containerType: 'inline-size' }}
      >
        {/* Camada 1: fundo (gradiente) */}
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 to-zinc-900" />

        {/* Camada 1b: thumbnail do YouTube (imediato, some quando o frame real chega) */}
        {thumb && (
          <img
            src={thumb}
            alt="thumb"
            className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300 ${frameReady ? 'opacity-0' : 'opacity-100'}`}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}

        {/* Camada 1c: frame real — posicionado igual ao backend (slider video_y) */}
        <img
          src={api.frameUrl(video.url)}
          alt="frame"
          className="object-cover pointer-events-none transition-opacity duration-200"
          style={{
            ...(aspect ? framePlacement(aspect.w, aspect.h, video.video_y ?? 0) : { position: 'absolute', inset: 0, width: '100%', height: '100%' }),
            opacity: frameReady && aspect ? 1 : 0,
          }}
          onLoad={e => {
            const im = e.currentTarget
            setAspect({ w: im.naturalWidth, h: im.naturalHeight })
            setFrameReady(true)
          }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />

        {/* Camada 2: overlay (PNG do overlay selecionado) */}
        {overlay && overlay.exists ? (
          <img
            src={overlay.url}
            alt={`Overlay ${overlay.id}`}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : null}

        {/* Camada 3: título (posição e cor reais do backend) */}
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

        {/* Camada 4: legenda — amostra do estilo selecionado (área estreita) */}
        <div
          className="absolute left-[18%] w-[64%] flex items-center justify-center"
          style={{ top: '78%' }}
        >
          {video.gerar_legenda
            ? renderLegendaSample(video.estilo_legenda || 'AMARELO_CLASSICO')
            : (
              <div className="w-full border border-dashed border-white/25 rounded-md flex items-center justify-center py-1">
                <span className="text-white/40 text-[8px] tracking-wide uppercase">sem legenda</span>
              </div>
            )}
        </div>

        {/* Camada 5: badge de narração */}
        {video.narrar_titulo && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent/80 backdrop-blur-sm">
            <Mic2 size={9} className="text-white" />
            <span className="text-white text-[8px] font-medium tracking-wide">NARRAÇÃO</span>
          </div>
        )}

        {/* Camada 6: TARJA — caixa preta arrastável/redimensionável */}
        {tarja.ativo && (
          <div
            className="absolute bg-black border border-accent/70 flex items-center justify-center cursor-move select-none"
            style={{
              left:   `${tarja.x * 100}%`,
              top:    `${tarja.y * 100}%`,
              width:  `${tarja.w * 100}%`,
              height: `${tarja.h * 100}%`,
            }}
            onMouseDown={e => startDrag('move', e)}
            title="Arraste para mover · puxe o canto para redimensionar"
          >
            {tarja.texto && (
              <span
                className="text-white text-center leading-tight px-1 overflow-hidden"
                style={{ fontSize: 'clamp(6px, 3cqw, 14px)' }}
              >
                {tarja.texto}
              </span>
            )}
            {/* Alça de redimensionar (canto inferior-direito) */}
            <div
              className="absolute -right-1 -bottom-1 w-2.5 h-2.5 bg-accent rounded-sm cursor-nwse-resize"
              onMouseDown={e => startDrag('resize', e)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
