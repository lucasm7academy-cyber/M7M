import { useEffect, useState, useCallback } from 'react'
import { api, type VideoItem, type GpuStatus, type OverlayInfo } from './api'
import { progressSocket, type WsEvent } from './ws'
import Header        from './components/Header'
import FolderPanel   from './components/FolderPanel'
import AddVideoPanel from './components/AddVideoPanel'
import VideoQueue    from './components/VideoQueue'
import ConfigPanel   from './components/ConfigPanel'
import PreviewPanel  from './components/PreviewPanel'
import ProgressPanel from './components/ProgressPanel'
import StatusBar     from './components/StatusBar'
import VoicePanel    from './components/VoicePanel'
import './index.css'

interface Toast { id: number; msg: string; color: 'green'|'yellow'|'red' }
let toastId = 0

export default function App() {
  const [gpu,        setGpu]        = useState<GpuStatus | null>(null)
  const [videos,     setVideos]     = useState<VideoItem[]>([])
  const [overlays,   setOverlays]   = useState<OverlayInfo[]>([])
  const [selected,   setSelected]   = useState<number | null>(null)
  const [processing, setProcessing] = useState(false)
  const [searching,  setSearching]  = useState(false)
  const [lastEvent,  setLastEvent]  = useState<WsEvent | null>(null)
  const [status,     setStatus]     = useState<{ msg: string; color: 'green' | 'red' | 'yellow' }>({ msg: 'Pronto para adicionar vídeos', color: 'green' })
  const [toasts,     setToasts]     = useState<Toast[]>([])
  /** epoch ms — quando o lote atual começou (ou null se ocioso) */
  const [batchStartedAt, setBatchStartedAt] = useState<number | null>(null)
  /** ms — duração total do último lote já encerrado */
  const [batchElapsedMs, setBatchElapsedMs] = useState<number | null>(null)
  /** aba ativa: editor de vídeo ou editor de voz */
  const [tab, setTab] = useState<'video' | 'voz'>('video')
  const [folderPanelOpen, setFolderPanelOpen] = useState(false)
  const [pastaVersion, setPastaVersion] = useState(0)

  const toast = useCallback((msg: string, color: Toast['color'] = 'green') => {
    const id = ++toastId
    setToasts(t => [...t, { id, msg, color }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  const refreshVideos = useCallback(async () => {
    const v = await api.getVideos().catch(() => [] as VideoItem[])
    setVideos(v)
  }, [])

  const refreshOverlays = useCallback(async () => {
    const o = await api.overlays().catch(() => [] as OverlayInfo[])
    setOverlays(o)
  }, [])

  useEffect(() => {
    api.gpu().then(setGpu).catch(() => {})
    refreshVideos()
    api.overlays().then(setOverlays).catch(() => {})

    progressSocket.connect((e: WsEvent) => {
      setLastEvent(e)
      if (e.type === 'batch_started') {
        setBatchStartedAt(e.at)
        setBatchElapsedMs(null)
      }
      if (e.type === 'started') {
        setVideos(prev => prev.map(v => v.id === e.id ? { ...v, started_at: e.at, finished_at: undefined, elapsed_ms: undefined } : v))
      }
      if (e.type === 'status') {
        setStatus({ msg: `Vídeo ${(e.idx ?? 0) + 1}: ${e.value}…`, color: 'yellow' })
        const baseByPhase: Record<string, number> = {
          baixando: 0, convertendo: 0.35, exportando: 0.40, concluido: 1, erro: 1,
        }
        setVideos(prev => prev.map(v =>
          v.id === e.id
            ? { ...v, status: e.value, progress: baseByPhase[e.value] ?? v.progress }
            : v))
      }
      if (e.type === 'progress') {
        const PHASE_WEIGHT: Record<string, [number, number]> = {
          baixando:   [0.00, 0.35],
          exportando: [0.40, 0.60],
        }
        const w = PHASE_WEIGHT[e.phase]
        if (w) {
          const global = w[0] + w[1] * Math.max(0, Math.min(1, e.fraction))
          setVideos(prev => prev.map(v =>
            v.id === e.id ? { ...v, progress: Math.max(v.progress ?? 0, global) } : v))
        }
      }
      if (e.type === 'done') {
        setVideos(prev => prev.map(v => v.id === e.id ? {
          ...v,
          status:      'concluido',
          processado:  true,
          started_at:  e.started_at,
          finished_at: e.finished_at,
          elapsed_ms:  e.elapsed_ms,
        } : v))
        toast(`✅ Vídeo concluído ${(e.elapsed_ms/1000).toFixed(1)}s`, 'green')
      }
      if (e.type === 'error') {
        setVideos(prev => prev.map(v => v.id === e.id ? {
          ...v,
          status:      'erro',
          upload_error: e.message,
          started_at:  e.started_at,
          finished_at: e.finished_at,
          elapsed_ms:  e.elapsed_ms,
        } : v))
        toast(`❌ Erro no vídeo`, 'red')
      }
      if (e.type === 'all_done') {
        setProcessing(false)
        setBatchStartedAt(null)
        setBatchElapsedMs(e.elapsed_ms)
        setStatus({ msg: `✅ Todos os ${e.total} vídeos processados em ${(e.elapsed_ms/1000).toFixed(1)}s`, color: 'green' })
        toast(`🎉 Concluído em ${(e.elapsed_ms/1000).toFixed(1)}s`, 'green')
      }
      if (e.type === 'uploading') {
        setVideos(prev => prev.map(v => v.id === e.id ? { ...v, status: 'enviando_drive' } : v))
      }
      if (e.type === 'uploaded') {
        setVideos(prev => prev.map(v => v.id === e.id ? {
          ...v,
          status: 'concluido',
          drive_id: e.drive_id,
          drive_url: e.drive_url,
        } : v))
      }
      if (e.type === 'cleaned') {
        setVideos(prev => prev.map(v => v.id === e.id ? { ...v, output_path: undefined } : v))
      }
      if (e.type === 'upload_error') {
        setVideos(prev => prev.map(v => v.id === e.id ? {
          ...v,
          status: 'erro_upload',
          upload_error: e.error,
        } : v))
        toast(`⚠️ Upload falhou`, 'red')
      }
    })
    return () => progressSocket.disconnect()
  }, [refreshVideos, toast])

  async function handleAddUrl(url: string) {
    const res = await api.addVideo(url)
    setVideos(v => [...v, res.video])
    setSelected(res.idx)
    setStatus({ msg: `Vídeo adicionado (total: ${videos.length + 1})`, color: 'green' })
    toast('Vídeo adicionado à fila')
  }

  async function handleSearch(tema: string, qtd: number) {
    setSearching(true)
    setStatus({ msg: `Buscando ${qtd} vídeos sobre "${tema}"…`, color: 'yellow' })
    try {
      const res = await api.search(tema, qtd)
      await refreshVideos()
      if (res.total === 0) { toast('Nenhum vídeo encontrado', 'red'); setStatus({ msg: 'Nenhum vídeo encontrado', color: 'red' }) }
      else { toast(`${res.total} vídeos adicionados`); setStatus({ msg: `✅ ${res.total} vídeos adicionados`, color: 'green' }); setSelected(0) }
    } catch { toast('Erro na busca', 'red'); setStatus({ msg: 'Erro na busca', color: 'red' }) }
    finally  { setSearching(false) }
  }

  async function handleDelete(idx: number) {
    await api.deleteVideo(idx)
    setVideos(v => { const n = [...v]; n.splice(idx, 1); return n })
    if (selected === idx) setSelected(null)
    else if (selected !== null && selected > idx) setSelected(selected - 1)
    toast('Vídeo removido', 'yellow')
  }

  async function handleUpdate(patch: Partial<Pick<VideoItem,'title'|'video_y'|'overlay'|'font'|'title_y'|'filtro'|'cor_titulo'|'titulo_borda'|'tarja'|'narrar_titulo'|'travar_inicio'|'narrations'|'gerar_legenda'|'estilo_legenda'|'voice'|'hook_ativo'|'hook_tipo'|'hook_texto'|'hook_som_entrada'|'hook_som_saida'|'musica_fundo'|'musica_modo'>>) {
    if (selected === null) return
    console.log('[handleUpdate] patch enviado:', patch)
    const updated = await api.updateVideo(selected, patch)
    console.log('[handleUpdate] resposta recebida:', updated, 'travar_inicio=', updated.travar_inicio)
    setVideos(v => v.map((item, i) => i === selected ? updated : item))
  }

  async function handleRandomTitle() {
    const { title } = await api.randomTitle()
    handleUpdate({ title })
  }

  async function handleProcess() {
    setProcessing(true)
    setStatus({ msg: 'Colocando vídeos na fila…', color: 'yellow' })
    try {
      const res = await api.process()
      if (!res.enfileirados) {
        setProcessing(false)
        setStatus({ msg: 'Nenhum vídeo para processar', color: 'green' })
        return
      }
      setStatus({ msg: `${res.enfileirados} vídeos na fila`, color: 'yellow' })
    }
    catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setProcessing(false)
      setStatus({ msg: `Erro: ${msg}`, color: 'red' })
      toast(`Erro: ${msg}`, 'red')
    }
  }

  const selectedVideo = selected !== null ? (videos[selected] ?? null) : null

  return (
    <div className="flex flex-col h-screen bg-bg overflow-hidden">
      <Header gpu={gpu} processing={processing} queueCount={videos.filter(v => !v.processado && (v.status === 'na_fila' || v.status === 'editando')).length} onProcess={handleProcess} onOpenPastas={() => setFolderPanelOpen(true)} pastaVersion={pastaVersion} />

      {/* Abas */}
      <div className="flex items-center gap-1.5 px-4 pt-3 shrink-0">
        <button
          onClick={() => setTab('video')}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-all cursor-pointer ${
            tab === 'video' ? 'bg-accent/20 border-accent text-accent' : 'bg-card border-border text-muted hover:text-white'
          }`}
        >🎬 Vídeo</button>
        <button
          onClick={() => setTab('voz')}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-all cursor-pointer ${
            tab === 'voz' ? 'bg-accent/20 border-accent text-accent' : 'bg-card border-border text-muted hover:text-white'
          }`}
        >🎙️ Voz</button>
      </div>

      {tab === 'video' && (
      <div className="flex flex-1 gap-4 p-4 overflow-hidden">
        {/* Left */}
        <div className="flex flex-col gap-4 w-[460px] shrink-0 overflow-hidden">
          <AddVideoPanel onAddUrl={handleAddUrl} onSearch={handleSearch} searching={searching} />
          <VideoQueue videos={videos} selectedIdx={selected} onSelect={setSelected} onDelete={handleDelete} onRefresh={refreshVideos} />
        </div>

        {/* Right */}
        <div className="flex flex-col gap-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[7fr_3fr] gap-4">
            <ConfigPanel
              video={selectedVideo}
              overlays={overlays}
              onChange={handleUpdate}
              onRandomTitle={handleRandomTitle}
              onRandomHook={async () => {
                const { hook } = await api.randomHook()
                handleUpdate({ hook_texto: hook })
              }}
              onOverlaysChanged={refreshOverlays}
              onRefreshVideos={refreshVideos}
              onToast={toast}
            />
            <PreviewPanel
              video={selectedVideo}
              overlay={overlays.find(o => o.id === selectedVideo?.overlay)}
              onChange={handleUpdate}
            />
          </div>
          <ProgressPanel
            videos={videos}
            processing={processing}
            lastEvent={lastEvent}
            batchStartedAt={batchStartedAt}
            batchElapsedMs={batchElapsedMs}
          />
        </div>
      </div>
      )}

      {tab === 'voz' && <VoicePanel onToast={toast} />}

      <div className="px-4 pb-4 shrink-0">
        <StatusBar message={status.msg} color={status.color} />
      </div>

      <FolderPanel open={folderPanelOpen} onClose={() => setFolderPanelOpen(false)} onChanged={() => { refreshVideos(); setPastaVersion(v => v + 1) }} onToast={toast} />

      {/* Toasts */}
      <div className="fixed bottom-20 right-4 space-y-2 z-50 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg border ${
            t.color === 'green' ? 'bg-success/20 border-success/30 text-success' :
            t.color === 'red'   ? 'bg-danger/20  border-danger/30  text-danger'  :
                                  'bg-warn/20    border-warn/30    text-warn'
          }`}>{t.msg}</div>
        ))}
      </div>
    </div>
  )
}
