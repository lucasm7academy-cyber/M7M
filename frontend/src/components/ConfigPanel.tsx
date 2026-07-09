import { Shuffle, Mic2, Plus, X, Captions, Square, Clock, Trash2, ChevronDown, Music } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type VideoItem, type OverlayInfo, type Tarja, type NarrationVoice, type MusicItem } from '../api'

const TARJA_DEFAULT: Tarja = { ativo: false, x: 0.35, y: 0.45, w: 0.30, h: 0.07, texto: '' }

const VIDEO_Y_MIN = -800
const VIDEO_Y_MAX = 800
const VIDEO_Y_DEFAULT = 0

const FONTS = ['Padrão', 'Manuscrita', 'Estilo 1', 'Estilo 2']

const FILTROS: { key: string; label: string }[] = [
  { key: 'Nenhum',         label: 'Nenhum' },
  { key: 'Suave',          label: 'Suave' },
  { key: 'Preto e Branco', label: 'P&B' },
]

const TITLE_Y_MIN = 50
const TITLE_Y_MAX = 700
const TITLE_Y_DEFAULT = 280

// Espelho de CORES_TITULO no backend (config.py)
const CORES: { key: string; hex: string }[] = [
  { key: 'Branco',   hex: '#FFFFFF' },
  { key: 'Amarelo',  hex: '#FFD400' },
  { key: 'Preto',    hex: '#000000' },
  { key: 'Vermelho', hex: '#FF3B30' },
  { key: 'Verde',    hex: '#27E36B' },
  { key: 'Azul',     hex: '#3B82F6' },
  { key: 'Rosa',     hex: '#FF2D95' },
]

const ESTILOS_LEGENDA: { key: string; label: string; desc: string }[] = [
  { key: 'AMARELO_CLASSICO', label: 'Amarelo', desc: 'palavra atual destacada' },
  { key: 'POP_BRANCO',       label: 'Pop',     desc: 'só a palavra falada' },
  { key: 'BOX_HORMOZI',      label: 'Caixa',   desc: 'caixa branca 3 palavras' },
  { key: 'NEON_VERDE',       label: 'Neon',    desc: 'glow verde fluo' },
]

interface Props {
  video:    VideoItem | null
  overlays: OverlayInfo[]
  onChange: (patch: Partial<Pick<VideoItem, 'title' | 'video_y' | 'overlay' | 'font' | 'title_y' | 'filtro' | 'cor_titulo' | 'titulo_borda' | 'tarja' | 'narrar_titulo' | 'travar_inicio' | 'narrations' | 'gerar_legenda' | 'estilo_legenda' | 'hook_ativo' | 'hook_tipo' | 'hook_texto' | 'hook_som_entrada' | 'hook_som_saida' | 'musica_fundo' | 'musica_modo'>>) => void
  onRandomTitle: () => void
  onRandomHook?: () => void
  onOverlaysChanged?: () => void
  onRefreshVideos?: () => void
  onToast?: (msg: string, color?: 'green' | 'red' | 'yellow') => void
}

export default function ConfigPanel({
  video,
  overlays,
  onChange,
  onRandomTitle,
  onRandomHook,
  onOverlaysChanged,
  onRefreshVideos,
  onToast,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)

  // Edição local do título: digita sem travamento e debounce envia PATCH.
  // Sem isso, cada tecla dispara um PATCH e o React re-renderiza com o
  // value vindo do servidor, causando a sensação de "input que não responde".
  const [titleDraft, setTitleDraft] = useState<string>(video?.title ?? '')
  const debounceRef = useRef<number | null>(null)
  const lastSyncedTitle = useRef<string>(video?.title ?? '')

  // Quando troca o vídeo selecionado (ou o backend sobrescreve o título —
  // ex: botão random), ressincroniza o draft.
  useEffect(() => {
    const t = video?.title ?? ''
    if (t !== lastSyncedTitle.current) {
      setTitleDraft(t)
      lastSyncedTitle.current = t
    }
  }, [video?.title])

  // Altura do título: estado local + debounce (slider dispara muitos eventos).
  const [titleYDraft, setTitleYDraft] = useState<number>(video?.title_y ?? TITLE_Y_DEFAULT)
  const titleYDebounce = useRef<number | null>(null)

  useEffect(() => {
    setTitleYDraft(video?.title_y ?? TITLE_Y_DEFAULT)
  }, [video?.title_y, video?.url])

  function handleTitleYChange(v: number) {
    setTitleYDraft(v)
    if (titleYDebounce.current !== null) window.clearTimeout(titleYDebounce.current)
    titleYDebounce.current = window.setTimeout(() => {
      onChange({ title_y: v })
      titleYDebounce.current = null
    }, 250)
  }

  // Posição do vídeo: slider com debounce
  const [videoYDraft, setVideoYDraft] = useState<number>(video?.video_y ?? VIDEO_Y_DEFAULT)
  const videoYDebounce = useRef<number | null>(null)

  useEffect(() => {
    setVideoYDraft(video?.video_y ?? VIDEO_Y_DEFAULT)
  }, [video?.video_y, video?.url])

  function handleVideoYChange(v: number) {
    setVideoYDraft(v)
    if (videoYDebounce.current !== null) window.clearTimeout(videoYDebounce.current)
    videoYDebounce.current = window.setTimeout(() => {
      onChange({ video_y: v })
      videoYDebounce.current = null
    }, 250)
  }

  // ── Vozes de narração ───────────────────────────────────────────
  const [narrationVoices, setNarrationVoices] = useState<NarrationVoice[]>([])
  const [voiceListLoaded, setVoiceListLoaded] = useState(false)

  useEffect(() => {
    api.narrationVoices()
      .then(vs => { setNarrationVoices(vs); setVoiceListLoaded(true) })
      .catch(() => { setVoiceListLoaded(false) })
    api.listMusic()
      .then(ms => setMusicList(ms))
      .catch(() => {})
  }, [])

  // ── Músicas Virais ──────────────────────────────────────────────
  const [musicList, setMusicList] = useState<MusicItem[]>([])

  // ── Tarja ──────────────────────────────────────────────────
  const tarja = video?.tarja ?? TARJA_DEFAULT
  const [tarjaTextDraft, setTarjaTextDraft] = useState<string>(tarja.texto)
  const tarjaTextDebounce = useRef<number | null>(null)

  useEffect(() => {
    setTarjaTextDraft(video?.tarja?.texto ?? '')
  }, [video?.url, video?.tarja?.texto])

  function patchTarja(partial: Partial<Tarja>) {
    onChange({ tarja: { ...tarja, ...partial } })
  }

  function handleTarjaTextChange(t: string) {
    setTarjaTextDraft(t)
    if (tarjaTextDebounce.current !== null) window.clearTimeout(tarjaTextDebounce.current)
    tarjaTextDebounce.current = window.setTimeout(() => {
      patchTarja({ texto: t })
      tarjaTextDebounce.current = null
    }, 350)
  }

  // ── Narrações personalizadas: estado local + debounce ─────────
  const [narTextDrafts, setNarTextDrafts] = useState<Record<string, string>>({})
  const [narSecDrafts, setNarSecDrafts] = useState<Record<string, number>>({})
  const narTextDebounce = useRef<Record<string, number | null>>({})
  const narSecDebounce = useRef<Record<string, number | null>>({})
  const lastSyncedNarrations = useRef<string>('')

  useEffect(() => {
    const raw = JSON.stringify(video?.narrations ?? [])
    if (raw === lastSyncedNarrations.current) return
    lastSyncedNarrations.current = raw
    const texts: Record<string, string> = {}
    const secs: Record<string, number> = {}
    for (const n of video?.narrations ?? []) {
      texts[n.id] = n.text
      secs[n.id] = n.start_sec
    }
    setNarTextDrafts(texts)
    setNarSecDrafts(secs)
  }, [video?.narrations])

  function flushNarrationText(id: string, val?: string) {
    if (narTextDebounce.current[id] !== null) {
      window.clearTimeout(narTextDebounce.current[id]!)
      narTextDebounce.current[id] = null
    }
    const t = val ?? narTextDrafts[id]
    if (t === undefined) return
    const cp = [...(video?.narrations ?? [])]
    const idx = cp.findIndex(x => x.id === id)
    if (idx === -1) return
    cp[idx] = { ...cp[idx], text: t }
    onChange({ narrations: cp })
  }

  function handleNarTextChange(id: string, val: string) {
    setNarTextDrafts(d => ({ ...d, [id]: val }))
    if (narTextDebounce.current[id] !== null) window.clearTimeout(narTextDebounce.current[id]!)
    narTextDebounce.current[id] = window.setTimeout(() => {
      flushNarrationText(id, val)
    }, 400)
  }

  function flushNarrationSec(id: string, val?: number) {
    if (narSecDebounce.current[id] !== null) {
      window.clearTimeout(narSecDebounce.current[id]!)
      narSecDebounce.current[id] = null
    }
    const v = val ?? narSecDrafts[id]
    if (v === undefined) return
    const cp = [...(video?.narrations ?? [])]
    const idx = cp.findIndex(x => x.id === id)
    if (idx === -1) return
    cp[idx] = { ...cp[idx], start_sec: v }
    onChange({ narrations: cp })
  }

  function handleNarSecChange(id: string, val: number) {
    setNarSecDrafts(d => ({ ...d, [id]: val }))
    if (narSecDebounce.current[id] !== null) window.clearTimeout(narSecDebounce.current[id]!)
    narSecDebounce.current[id] = window.setTimeout(() => {
      flushNarrationSec(id, val)
    }, 250)
  }

  function handleTitleChange(novo: string) {
    setTitleDraft(novo)
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
    }
    debounceRef.current = window.setTimeout(() => {
      lastSyncedTitle.current = novo
      onChange({ title: novo })
      debounceRef.current = null
    }, 400)
  }

  // Flush imediato ao perder o foco — garante que o PATCH sai antes de
  // mudar de vídeo / clicar processar.
  function flushTitle() {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
      if (titleDraft !== lastSyncedTitle.current) {
        lastSyncedTitle.current = titleDraft
        onChange({ title: titleDraft })
      }
    }
  }

  async function handleUploadClick() {
    fileInputRef.current?.click()
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''   // permite re-upload do mesmo arquivo
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.png')) {
      onToast?.('Selecione um arquivo PNG', 'red')
      return
    }
    setBusy(true)
    try {
      const novo = await api.uploadOverlay(file)
      onToast?.(`Overlay ${novo.id} adicionado`, 'green')
      onOverlaysChanged?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onToast?.(`Erro no upload: ${msg}`, 'red')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteOverlay(key: string, ev: React.MouseEvent) {
    ev.stopPropagation()
    if (!confirm(`Excluir overlay ${key}? O arquivo será removido do projeto.`)) return
    setBusy(true)
    try {
      await api.deleteOverlay(key)
      onToast?.(`Overlay ${key} excluído`, 'yellow')
      onOverlaysChanged?.()
      onRefreshVideos?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onToast?.(`Erro ao excluir: ${msg}`, 'red')
    } finally {
      setBusy(false)
    }
  }

  if (!video) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 flex flex-col items-center justify-center min-h-[180px]">
        <span className="text-3xl mb-2">🎯</span>
        <p className="text-muted text-xs text-center">Selecione um vídeo na fila<br />para configurar</p>
      </div>
    )
  }

  const selectedVoice = video?.voice || 'padrao'

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <h2 className="text-white font-semibold text-sm">Configurações do vídeo</h2>

      {/* Título */}
      <div className="space-y-1">
        <label className="text-muted text-[11px]">Título</label>
        <div className="flex gap-1.5">
          <input
            className="flex-1 min-w-0 bg-card2 border border-border rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent transition-colors"
            value={titleDraft}
            onChange={e => handleTitleChange(e.target.value)}
            onBlur={flushTitle}
          />
          <button
            onClick={onRandomTitle}
            className="px-2 py-1.5 bg-card2 hover:bg-border border border-border rounded-md text-muted hover:text-white transition-all cursor-pointer shrink-0"
            title="Título aleatório"
          >
            <Shuffle size={12} />
          </button>
        </div>
      </div>

      {/* Posição do vídeo (slider) */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-muted text-[11px]">Posição do vídeo</label>
          <span className="text-accent text-[10px] font-mono">{videoYDraft}px</span>
        </div>
        <input
          type="range"
          min={VIDEO_Y_MIN}
          max={VIDEO_Y_MAX}
          value={videoYDraft}
          onChange={e => handleVideoYChange(Number(e.target.value))}
          className="w-full accent-accent cursor-pointer"
        />
        <div className="flex justify-between text-muted text-[9px]">
          <span>Sobe (mostra base)</span>
          <span>Desce (mostra topo)</span>
        </div>
      </div>

      {/* Fonte */}
      <div className="space-y-1">
        <label className="text-muted text-[11px]">Fonte do título</label>
        <div className="grid grid-cols-4 gap-1.5">
          {FONTS.map(f => (
            <button
              key={f}
              onClick={() => onChange({ font: f })}
              className={`py-1 text-[10px] font-medium rounded-md border transition-all cursor-pointer ${
                (video.font || 'Padrão') === f
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-card2 border-border text-muted hover:text-white hover:border-muted'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Cor do título */}
      <div className="space-y-1">
        <label className="text-muted text-[11px]">Cor do título</label>
        <div className="flex gap-1.5 flex-wrap">
          {CORES.map(c => {
            const ativo = (video.cor_titulo || 'Branco') === c.key
            return (
              <button
                key={c.key}
                onClick={() => onChange({ cor_titulo: c.key })}
                title={c.key}
                className={`w-7 h-7 rounded-full border-2 transition-all cursor-pointer ${
                  ativo ? 'border-accent ring-2 ring-accent/40 scale-110' : 'border-border hover:border-muted'
                }`}
                style={{ backgroundColor: c.hex }}
              />
            )
          })}
        </div>
      </div>

      {/* Borda + sombra do título */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          className="accent-accent w-3.5 h-3.5 cursor-pointer"
          checked={video.titulo_borda ?? true}
          onChange={e => onChange({ titulo_borda: e.target.checked })}
        />
        <span className="text-muted text-[11px]">Borda e sombra preta no título</span>
      </label>

      {/* Altura do título */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-muted text-[11px]">Altura do título</label>
          <span className="text-accent text-[10px] font-mono">{titleYDraft}px</span>
        </div>
        <input
          type="range"
          min={TITLE_Y_MIN}
          max={TITLE_Y_MAX}
          value={titleYDraft}
          onChange={e => handleTitleYChange(Number(e.target.value))}
          className="w-full accent-accent cursor-pointer"
        />
        <div className="flex justify-between text-muted text-[9px]">
          <span>Topo</span>
          <span>Base</span>
        </div>
      </div>

      {/* Overlay */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-muted text-[11px]">Overlay</label>
          <span className="text-muted text-[9px]">overlay&lt;N&gt;.png</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {overlays.map(ov => (
            <div key={ov.id} className="relative group">
              <button
                onClick={() => onChange({ overlay: ov.id })}
                title={`Overlay ${ov.id}`}
                className={`relative w-10 h-14 rounded-md border overflow-hidden transition-all cursor-pointer ${
                  video.overlay === ov.id
                    ? 'border-accent ring-2 ring-accent/40'
                    : 'border-border hover:border-muted'
                } ${!ov.exists ? 'opacity-40' : ''}`}
              >
                {ov.exists ? (
                  <img
                    src={ov.url}
                    alt={`Overlay ${ov.id}`}
                    className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : null}
                <div className="absolute inset-0 flex items-end justify-center pb-0.5">
                  <span className="text-white text-[10px] font-bold drop-shadow">{ov.id}</span>
                </div>
              </button>
              <button
                onClick={ev => handleDeleteOverlay(ov.id, ev)}
                disabled={busy}
                title={`Excluir overlay ${ov.id}`}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X size={10} />
              </button>
            </div>
          ))}

          {/* Botão de adicionar */}
          <button
            onClick={handleUploadClick}
            disabled={busy}
            title="Adicionar novo overlay (PNG)"
            className="w-10 h-14 rounded-md border border-dashed border-border hover:border-accent hover:text-accent text-muted flex items-center justify-center transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,.png"
            className="hidden"
            onChange={handleFileSelected}
          />
        </div>
      </div>

      {/* Filtro de vídeo */}
      <div className="space-y-1">
        <label className="text-muted text-[11px]">Filtro de vídeo</label>
        <div className="flex gap-1.5">
          {FILTROS.map(f => (
            <button
              key={f.key}
              onClick={() => onChange({ filtro: f.key })}
              title={f.key}
              className={`flex-1 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer ${
                (video.filtro || 'Nenhum') === f.key
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'bg-card2 border-border text-muted hover:text-white hover:border-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Narração */}
      <div className="space-y-1">
        <label className="text-muted text-[11px]">Narração</label>
        <button
          onClick={() => onChange({ narrar_titulo: !video.narrar_titulo })}
          className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-md border transition-all cursor-pointer ${
            video.narrar_titulo
              ? 'bg-accent/20 border-accent text-accent'
              : 'bg-card2 border-border text-muted hover:text-white hover:border-muted'
          }`}
          title="Quando ligado: gera voz neural lendo o título e mixa no clip final (delay 0.5s, ducking do áudio original)"
        >
          <Mic2 size={12} />
          <span>Narrar título</span>
          <span className="ml-auto text-[9px] uppercase tracking-wide">
            {video.narrar_titulo ? 'ON' : 'OFF'}
          </span>
        </button>

        {/* Seletor de voz (movido para fora de narrar_titulo) */}
        <div className="space-y-1 pt-2">
          <label className="text-muted text-[11px]">Personagem da Voz</label>
          <div className="relative">
            <select
              value={selectedVoice}
              onChange={e => onChange({ voice: e.target.value })}
              className="w-full appearance-none bg-card2 border border-border rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent transition-colors cursor-pointer"
            >
              {narrationVoices.map(v => (
                <option key={v.id} value={v.id} disabled={v.tipo === 'offline'} title={v.desc}>
                  {v.label}
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          </div>
          {selectedVoice !== 'padrao' && (
            <p className="text-accent/70 text-[9px] italic">
              Estilo: viral TikTok · Calor 0% · Eco de estúdio desligado
            </p>
          )}
        </div>

        {video.narrar_titulo && (
          <>
            <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                className="accent-accent w-3.5 h-3.5 cursor-pointer"
                checked={video.travar_inicio ?? false}
                onChange={e => onChange({ travar_inicio: e.target.checked })}
              />
              <span className="text-muted text-[11px]">Travar início (notificação + narração do título)</span>
            </label>
          </>
        )}
      </div>

      {/* Narrações personalizadas */}
      <div className="space-y-1">
        <label className="text-muted text-[11px]">Narrações personalizadas</label>
        <div className="space-y-2">
          {(video.narrations ?? []).map((n, i) => (
            <div key={n.id} className="bg-card2 border border-border rounded-md p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <textarea
                  className="flex-1 min-w-0 bg-bg border border-border rounded-md px-2 py-1 text-[11px] text-white outline-none focus:border-accent transition-colors resize-none"
                  rows={2}
                  placeholder="Texto da narração..."
                  value={narTextDrafts[n.id] ?? n.text}
                  onChange={e => handleNarTextChange(n.id, e.target.value)}
                  onBlur={() => flushNarrationText(n.id)}
                />
                <button
                  onClick={() => {
                    const cp = (video.narrations ?? []).filter(x => x.id !== n.id)
                    onChange({ narrations: cp })
                  }}
                  className="text-muted hover:text-red-400 cursor-pointer shrink-0"
                  title="Remover"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={11} className="text-muted shrink-0" />
                <input
                  type="range"
                  min={0}
                  max={video.duration ?? 120}
                  step={0.5}
                  value={narSecDrafts[n.id] ?? n.start_sec}
                  onChange={e => handleNarSecChange(n.id, Number(e.target.value))}
                  onMouseUp={() => flushNarrationSec(n.id)}
                  onTouchEnd={() => flushNarrationSec(n.id)}
                  className="flex-1 accent-accent cursor-pointer"
                />
                <span className="text-accent text-[10px] font-mono w-10 text-right">{(narSecDrafts[n.id] ?? n.start_sec).toFixed(1)}s</span>
              </div>
              <div className="flex items-center gap-3 pt-0.5">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="accent-accent w-3 h-3 cursor-pointer"
                    checked={n.freeze ?? false}
                    onChange={e => {
                      const cp = (video.narrations ?? []).map(x => x.id === n.id ? { ...x, freeze: e.target.checked } : x)
                      onChange({ narrations: cp })
                    }}
                  />
                  <span className="text-muted text-[10px]">Freeze</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="accent-accent w-3 h-3 cursor-pointer"
                    checked={n.legenda ?? false}
                    onChange={e => {
                      const cp = (video.narrations ?? []).map(x => x.id === n.id ? { ...x, legenda: e.target.checked } : x)
                      onChange({ narrations: cp })
                    }}
                  />
                  <span className="text-muted text-[10px]">Legenda</span>
                </label>
              </div>

            </div>
          ))}
          <button
            onClick={() => {
              const cp = [...(video.narrations ?? [])]
              const prev = cp.length > 0 ? cp[cp.length - 1] : null
              const durMax = video.duration ?? 120
              let lastSec = 2
              if (prev) {
                const estDur = Math.max(2, prev.text.length * 0.1)
                lastSec = Math.min(prev.start_sec + estDur, durMax)
              }
              cp.push({ id: crypto.randomUUID(), text: '', start_sec: lastSec })
              onChange({ narrations: cp })
            }}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-md border border-dashed border-border text-muted hover:text-accent hover:border-accent transition-all cursor-pointer"
          >
            <Plus size={12} />
            Adicionar narração
          </button>
        </div>
      </div>

      {/* Legenda automática (TikTok) */}
      <div className="space-y-1">
        <label className="text-muted text-[11px]">Legenda automática</label>
        <button
          onClick={() => onChange({ gerar_legenda: !video.gerar_legenda })}
          className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-md border transition-all cursor-pointer ${
            video.gerar_legenda
              ? 'bg-accent/20 border-accent text-accent'
              : 'bg-card2 border-border text-muted hover:text-white hover:border-muted'
          }`}
          title="Transcreve a fala (faster-whisper) e queima legenda animada palavra por palavra"
        >
          <Captions size={12} />
          <span>Legenda TikTok</span>
          <span className="ml-auto text-[9px] uppercase tracking-wide">
            {video.gerar_legenda ? 'ON' : 'OFF'}
          </span>
        </button>

        {video.gerar_legenda && (
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            {ESTILOS_LEGENDA.map(e => {
              const ativo = (video.estilo_legenda || 'AMARELO_CLASSICO') === e.key
              return (
                <button
                  key={e.key}
                  onClick={() => onChange({ estilo_legenda: e.key })}
                  title={e.desc}
                  className={`flex flex-col items-start gap-0 px-2 py-1.5 rounded-md border transition-all cursor-pointer ${
                    ativo
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'bg-card2 border-border text-muted hover:text-white hover:border-muted'
                  }`}
                >
                  <span className="text-[11px] font-semibold leading-tight">{e.label}</span>
                  <span className="text-[9px] leading-tight opacity-80">{e.desc}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Hook (gancho de 3s) */}
      <div className="space-y-1">
        <label className="text-muted text-[11px]">Hook (gancho de 3s)</label>
        <button
          onClick={() => onChange({ hook_ativo: !video.hook_ativo })}
          className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-md border transition-all cursor-pointer ${
            video.hook_ativo
              ? 'bg-accent/20 border-accent text-accent'
              : 'bg-card2 border-border text-muted hover:text-white hover:border-muted'
          }`}
          title="Insere um gancho de 3 segundos antes do vídeo (blur, textão ou corte seco)"
        >
          <span className="text-base">⚡</span>
          <span>Gancho</span>
          <span className="ml-auto text-[9px] uppercase tracking-wide">
            {video.hook_ativo ? 'ON' : 'OFF'}
          </span>
        </button>

        {video.hook_ativo && (
          <div className="space-y-1.5 pt-1">
            {/* Tipo de hook */}
            <div className="space-y-1">
              <label className="text-muted text-[10px]">Estilo Visual do Gancho</label>
              <select
                value={video.hook_tipo ?? 'textao'}
                onChange={e => onChange({ hook_tipo: e.target.value })}
                className="w-full bg-card2 border border-border rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent transition-colors cursor-pointer"
              >
                <option value="textao">Textão (full HD + letras grandes)</option>
                <option value="corte_seco">Corte Seco (zoom + impacto)</option>
              </select>
            </div>

            {/* Texto personalizado */}
            <div className="space-y-1">
              <label className="text-muted text-[10px]">Texto do Gancho (3s)</label>
              <div className="flex gap-1.5">
                <input
                  className="flex-1 min-w-0 bg-card2 border border-border rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent transition-colors"
                  placeholder="Texto do gancho (ex: OLHA ISSO!)"
                  value={video.hook_texto ?? ''}
                  onChange={e => onChange({ hook_texto: e.target.value })}
                />
                {onRandomHook && (
                  <button
                    onClick={onRandomHook}
                    className="px-2 py-1.5 bg-card2 hover:bg-border border border-border rounded-md text-muted hover:text-white transition-all cursor-pointer shrink-0"
                    title="Gancho aleatório"
                  >
                    <Shuffle size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Efeitos sonoros */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-muted text-[10px]">Som de Entrada (t=0s)</label>
                <select
                  value={video.hook_som_entrada ?? 'none'}
                  onChange={e => onChange({ hook_som_entrada: e.target.value })}
                  className="w-full bg-card2 border border-border rounded-md px-2 py-1.5 text-[11px] text-white outline-none focus:border-accent transition-colors cursor-pointer"
                >
                  <option value="none">🔇 Sem som</option>
                  <option value="whoosh">Whoosh (💥 impacto)</option>
                  <option value="camera">Câmera (📸 flash)</option>
                  <option value="click">Click (🖱️ rápido)</option>
                  <option value="notificacao">Pop (🔔 notificação)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-muted text-[10px]">Som de Saída (t=3s)</label>
                <select
                  value={video.hook_som_saida ?? 'whoosh'}
                  onChange={e => onChange({ hook_som_saida: e.target.value })}
                  className="w-full bg-card2 border border-border rounded-md px-2 py-1.5 text-[11px] text-white outline-none focus:border-accent transition-colors cursor-pointer"
                >
                  <option value="none">🔇 Sem som</option>
                  <option value="whoosh">Whoosh (💥 transição)</option>
                  <option value="camera">Câmera (📸 flash)</option>
                  <option value="click">Click (🖱️ rápido)</option>
                  <option value="notificacao">Pop (🔔 notificação)</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Trilha Sonora (Música Viral) */}
      <div className="space-y-1.5 pt-1 border-t border-border/50">
        <label className="text-muted text-[11px] flex items-center gap-1 font-medium text-white">
          <Music size={12} className="text-accent" />
          <span>Trilha Sonora Viral</span>
        </label>
        <div className="space-y-1.5 bg-card/40 p-2 rounded-md border border-border/60">
          <select
            value={video.musica_fundo ?? 'none'}
            onChange={e => onChange({ musica_fundo: e.target.value })}
            className="w-full bg-card2 border border-border rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent transition-colors cursor-pointer"
          >
            <option value="none">🔇 Sem música de fundo</option>
            {musicList.map(m => (
              <option key={m.id} value={m.file}>🎵 {m.label}</option>
            ))}
          </select>

          {video.musica_fundo && video.musica_fundo !== 'none' && (
            <div className="flex gap-1 pt-0.5">
              <button
                onClick={() => onChange({ musica_modo: '100_musica' })}
                className={`flex-1 py-1 px-1.5 rounded text-[10px] font-medium border transition-all cursor-pointer ${
                  (video.musica_modo ?? '100_musica') === '100_musica'
                    ? 'bg-accent/20 border-accent text-accent font-semibold'
                    : 'bg-card2 border-border text-muted hover:text-white'
                }`}
                title="Muta o áudio original do vídeo e toca apenas a música + narração"
              >
                100% Música (Sem Áudio Original)
              </button>
              <button
                onClick={() => onChange({ musica_modo: '50_50' })}
                className={`flex-1 py-1 px-1.5 rounded text-[10px] font-medium border transition-all cursor-pointer ${
                  video.musica_modo === '50_50'
                    ? 'bg-accent/20 border-accent text-accent font-semibold'
                    : 'bg-card2 border-border text-muted hover:text-white'
                }`}
                title="Mixa a música com 30% e 100% do áudio original do vídeo"
              >
                30% Música / 100% Original
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tarja (cobre marca d'água) */}
      <div className="space-y-1">
        <label className="text-muted text-[11px]">Tarja (cobrir marca d'água)</label>
        <button
          onClick={() => patchTarja({ ativo: !tarja.ativo })}
          className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-md border transition-all cursor-pointer ${
            tarja.ativo
              ? 'bg-accent/20 border-accent text-accent'
              : 'bg-card2 border-border text-muted hover:text-white hover:border-muted'
          }`}
          title="Caixa preta que você arrasta/redimensiona no preview para cobrir a marca d'água"
        >
          <Square size={12} />
          <span>Tarja preta</span>
          <span className="ml-auto text-[9px] uppercase tracking-wide">{tarja.ativo ? 'ON' : 'OFF'}</span>
        </button>

        {tarja.ativo && (
          <div className="space-y-1 pt-1">
            <input
              className="w-full bg-card2 border border-border rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent transition-colors"
              placeholder="Texto dentro da tarja (opcional)"
              value={tarjaTextDraft}
              onChange={e => handleTarjaTextChange(e.target.value)}
            />
            <p className="text-muted text-[9px]">↔ Arraste a caixa no preview para mover · puxe o canto para redimensionar</p>
          </div>
        )}
      </div>

      {/* URL info */}
      <div className="space-y-0.5">
        <label className="text-muted text-[11px]">URL</label>
        <p className="text-muted text-[10px] bg-card2 rounded-md px-2 py-1.5 break-all line-clamp-2">{video.url}</p>
      </div>
    </div>
  )
}
