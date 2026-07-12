import { useEffect, useState, useCallback } from 'react'
import { api, type Ranking } from '../api'
import { progressSocket, type WsEvent } from '../ws'
import RankingCreatePanel    from './RankingCreatePanel'
import RankingList           from './RankingList'
import RankingGlobalConfigPanel from './RankingGlobalConfigPanel'
import RankingItemCard       from './RankingItemCard'
import RankingPreviewPanel   from './RankingPrefiewPanel'
import RankingProgressPanel  from './RankingProgressPanel'

interface Props {
  onToast: (msg: string, color?: 'green' | 'red' | 'yellow') => void
}

interface Toast { id: number; msg: string; color: 'green'|'yellow'|'red' }
let toastId = 0

export default function RankingTab({ onToast }: Props) {
  const [rankings, setRankings] = useState<Ranking[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeItemPos, setActiveItemPos] = useState<number>(0)
  const [overlays, setOverlays] = useState<any[]>([])
  const [processing, setProcessing] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((msg: string, color: Toast['color'] = 'green') => {
    const id = ++toastId
    setToasts(t => [...t, { id, msg, color }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  const refreshRankings = useCallback(async () => {
    const list = await api.listRankings().catch(() => [] as Ranking[])
    setRankings(list)
  }, [])

  const refreshOverlays = useCallback(async () => {
    const o = await api.overlays().catch(() => [])
    setOverlays(o)
  }, [])

  useEffect(() => {
    refreshOverlays()
  }, [refreshOverlays])

  const selected = rankings.find(r => r.id === selectedId) ?? null

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const handleCreate = useCallback((r: Ranking) => {
    setRankings(prev => [...prev, r])
    setSelectedId(r.id)
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Excluir este ranking?')) return
    try {
      await api.deleteRanking(id)
      setRankings(prev => prev.filter(r => r.id !== id))
      if (selectedId === id) setSelectedId(null)
      toast('Ranking excluído', 'yellow')
    } catch (e) {
      toast(`Erro ao excluir: ${e}`, 'red')
    }
  }, [selectedId, toast])

  const handleGlobalChange = useCallback(async (patch: Partial<Ranking>) => {
    if (!selected) return
    
    // Atualização otimista imediata para não travar a digitação/slider
    setRankings(prev => prev.map(r => r.id === selected.id ? { ...r, ...patch } : r))
    
    try {
      const updated = await api.updateRanking(selected.id, patch)
      // Se a quantidade de itens mudou, precisamos pegar os itens novos criados pelo servidor
      if (patch.quantidade !== undefined) {
        setRankings(prev => prev.map(r => r.id === selected.id ? { ...r, itens: updated.itens } : r))
      }
    } catch (e) {
      console.error(e)
    }
  }, [selected])

  const handleItemChange = useCallback((index: number, patch: Partial<RankingItem>, skipSave = false) => {
    if (!selected) return
    const items = [...selected.itens]
    items[index] = { ...items[index], ...patch }
    const updated = { ...selected, itens: items }
    setRankings(prev => prev.map(r => r.id === selected.id ? updated : r))
    
    // Save to backend immediately using the correct item endpoint
    if (!skipSave && (patch.video_y !== undefined || patch.overlay !== undefined || patch.filtro !== undefined || patch.narracao_texto !== undefined || patch.trim_inicio_s !== undefined || patch.trim_fim_s !== undefined || patch.titulo_item !== undefined || patch.title_y !== undefined || patch.font !== undefined || patch.cor_titulo !== undefined || patch.titulo_borda !== undefined)) {
      api.setRankingItem(selected.id, items[index].posicao, patch).catch(console.error)
    }
  }, [selected])

  const handleMoveUp = useCallback((pos: number) => {
    if (!selected || pos === 0) return
    const items = [...selected.itens].map(i => ({...i}));
    [items[pos - 1], items[pos]] = [items[pos], items[pos - 1]];
    
    const order = items.map(it => it.posicao);
    items.forEach((it, idx) => { it.posicao = idx + 1; });
    
    const updated = { ...selected, itens: items }
    setRankings(prev => prev.map(r => r.id === selected.id ? updated : r))
    api.reorderRanking(selected.id, order).catch(console.error)
  }, [selected])

  const handleMoveDown = useCallback((pos: number) => {
    if (!selected || pos >= selected.itens.length - 1) return
    const items = [...selected.itens].map(i => ({...i}));
    [items[pos], items[pos + 1]] = [items[pos + 1], items[pos]];
    
    const order = items.map(it => it.posicao);
    items.forEach((it, idx) => { it.posicao = idx + 1; });
    
    const updated = { ...selected, itens: items }
    setRankings(prev => prev.map(r => r.id === selected.id ? updated : r))
    api.reorderRanking(selected.id, order).catch(console.error)
  }, [selected])

  const handleProcess = useCallback(async () => {
    if (!selected) return
    setProcessing(true)
    try {
      await api.processRanking()
      toast('Ranking enfileirado para processamento')
      refreshRankings()
    } catch (e) {
      toast(`Erro ao processar: ${e}`, 'red')
    }
    setProcessing(false)
  }, [selected, toast, refreshRankings])

  useEffect(() => {
    refreshRankings()
  }, [refreshRankings])

  useEffect(() => {
    const handler = (e: WsEvent) => {
      const targetId = e.id || (e as any).ranking_id
      if (!targetId) return

      if (e.type === 'ranking_status') {
        setRankings(prev => prev.map(r => r.id === targetId ? {
          ...r,
          status: e.value as Ranking['status'],
          ...(e.started_at ? { started_at: e.started_at } : {}),
          ...((e as any).drive_url ? { drive_url: (e as any).drive_url, drive_id: (e as any).drive_id } : {}),
          ...((e as any).elapsed_ms ? { elapsed_ms: (e as any).elapsed_ms } : {})
        } : r))
      }
      if (e.type === 'ranking_progress') {
        setRankings(prev => prev.map(r => r.id === targetId ? { ...r, atual: e.atual, total: e.total } : r))
      }
      if (e.type === 'ranking_done') {
        setRankings(prev => prev.map(r => r.id === targetId ? {
          ...r,
          status: 'concluido',
          processado: true,
          elapsed_ms: e.elapsed_ms,
          drive_url: (e as any).drive_url,
          drive_id: (e as any).drive_id
        } : r))
        toast('Ranking concluído!')
      }
      if (e.type === 'ranking_error') {
        setRankings(prev => prev.map(r => r.id === targetId ? { ...r, status: 'erro', upload_error: e.message } : r))
        toast(`Erro no ranking: ${e.message}`, 'red')
      }
    }
    const unsubscribe = progressSocket.connect(handler)
    return unsubscribe
  }, [toast])

  return (
    <div className="flex flex-col xl:flex-row flex-1 gap-4 p-4 overflow-y-auto xl:overflow-hidden">
      {/* Left: Lista */}
      <div className="flex flex-col gap-4 w-full xl:w-[460px] xl:shrink-0 xl:overflow-hidden">
        <RankingCreatePanel onCreate={handleCreate} onToast={toast} />
        <RankingList
          rankings={rankings}
          selectedId={selectedId}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onRefresh={refreshRankings}
        />
      </div>

      {/* Right: detalhes */}
      {selected && (
      <div className="flex flex-col gap-4 flex-1 xl:overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-4">
          <div className="space-y-4">
            <RankingGlobalConfigPanel ranking={selected} overlays={overlays} onChange={handleGlobalChange} />

            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-white font-semibold text-sm">Itens do Ranking</h2>
                {selected.itens.length >= 2 && (
                  <button
                    onClick={handleProcess}
                    disabled={processing}
                    className="px-4 py-2 rounded-lg bg-brand-gradient text-white text-sm font-semibold shadow-glow hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    {processing ? 'Processando…' : 'Processar'}
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {selected.itens.map((item, i) => (
                  <RankingItemCard
                    key={i}
                    item={item}
                    pos={i}
                    total={selected.quantidade}
                    rankingId={selected.id}
                    isActive={activeItemPos === i}
                    onClick={() => setActiveItemPos(i)}
                    overlays={overlays}
                    onItemChange={handleItemChange}
                    onRefresh={refreshRankings}
                    onMoveUp={i > 0 ? () => handleMoveUp(i) : undefined}
                    onMoveDown={i < selected.itens.length - 1 ? () => handleMoveDown(i) : undefined}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4 sticky top-4 self-start">
            <RankingPreviewPanel 
              ranking={selected} 
              activeItem={selected.itens[activeItemPos] ?? null}
              overlays={overlays}
              onItemChange={(patch) => handleItemChange(activeItemPos, patch)}
            />
          </div>
        </div>
        <RankingProgressPanel ranking={selected} processing={processing} />
      </div>
      )}

      {!selected && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <span className="text-5xl mb-4 block">🏆</span>
            <p className="text-muted text-sm">Selecione ou crie um ranking para configurar</p>
          </div>
        </div>
      )}

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