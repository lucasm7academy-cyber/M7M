import { useState, useEffect, useRef } from 'react'
import { Music, Volume2 } from 'lucide-react'
import { api, type Ranking, type OverlayInfo, type MusicItem, RANKING_QUANTIDADES, RANKING_TRANSICOES, RANKING_ESTILOS_LEGENDA } from '../api'

interface Props {
  ranking: Ranking
  overlays?: OverlayInfo[]
  onChange: (patch: Partial<Ranking>) => void
}

export default function RankingGlobalConfigPanel({ ranking, overlays, onChange }: Props) {
  const handleChange = (patch: Partial<Ranking>) => {
    onChange(patch)
  }

  const [titleYDraft, setTitleYDraft] = useState<number>(ranking.title_y ?? 220)
  const [itensYDraft, setItensYDraft] = useState<number>(ranking.itens_y ?? 538)
  const [tituloGeralDraft, setTituloGeralDraft] = useState<string>(ranking.titulo_geral || '')
  const [musicList, setMusicList] = useState<MusicItem[]>([])

  useEffect(() => {
    setTitleYDraft(ranking.title_y ?? 220)
    setItensYDraft(ranking.itens_y ?? 538)
    setTituloGeralDraft(ranking.titulo_geral || '')
  }, [ranking.id]) // Só reseta quando troca de ranking selecionado

  useEffect(() => {
    api.listMusic().then(setMusicList).catch(() => {})
  }, [])

  const debounceRef = useRef<number | null>(null)
  const debounceItensYRef = useRef<number | null>(null)
  const debounceTituloRef = useRef<number | null>(null)

  function handleTitleYChange(val: number) {
    setTitleYDraft(val)
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      handleChange({ title_y: val })
    }, 200)
  }

  function handleItensYChange(val: number) {
    setItensYDraft(val)
    if (debounceItensYRef.current) window.clearTimeout(debounceItensYRef.current)
    debounceItensYRef.current = window.setTimeout(() => {
      handleChange({ itens_y: val })
    }, 200)
  }

  function handleTituloGeralChange(val: string) {
    setTituloGeralDraft(val)
    if (debounceTituloRef.current) window.clearTimeout(debounceTituloRef.current)
    debounceTituloRef.current = window.setTimeout(() => {
      handleChange({ titulo_geral: val })
    }, 400)
  }

  const CORES = [
    { key: 'Amarelo', hex: '#FFD400' },
    { key: 'Branco', hex: '#FFFFFF' },
    { key: 'Preto', hex: '#000000' },
    { key: 'Verde', hex: '#27E36B' },
    { key: 'Vermelho', hex: '#FF3B30' },
    { key: 'Azul', hex: '#3B82F6' },
    { key: 'Rosa', hex: '#FF2D95' },
  ]

  return (
    <div className="card p-4 space-y-4">
      <h2 className="text-white font-semibold text-sm">Configuração do Ranking</h2>

      <div className="space-y-2">
        <label className="text-muted text-xs">Título geral</label>
        <input
          className="w-full px-3 py-2 rounded-lg bg-card2 border border-border text-white text-sm outline-none focus:border-accent transition-colors"
          value={tituloGeralDraft}
          onChange={e => handleTituloGeralChange(e.target.value)}
          placeholder="Ex: Top 5 jogadas insanas"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-xs text-muted">Quantidade</label>
          <div className="flex gap-1">
            {RANKING_QUANTIDADES.map(q => (
              <button
                key={q}
                onClick={() => handleChange({ quantidade: q })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all cursor-pointer ${
                  ranking.quantidade === q
                    ? 'bg-accent/20 border-accent text-accent'
                    : 'border-border text-muted hover:border-accent hover:text-white'
                }`}
              >{q}</button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted">Ordem</label>
          <div className="flex gap-1">
            {['decrescente', 'crescente'].map(o => (
              <button
                key={o}
                onClick={() => handleChange({ ordem: o })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all cursor-pointer ${
                  ranking.ordem === o
                    ? 'bg-accent/20 border-accent text-accent'
                    : 'border-border text-muted hover:border-accent hover:text-white'
                }`}
              >{o === 'decrescente' ? 'Top → Baixo' : 'Baixo → Top'}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="pt-2 border-t border-border/50 space-y-3">
        <h3 className="text-xs font-semibold text-white/80">Design do Título Geral</h3>
        
        {/* Fonte do título */}
        <div className="space-y-1">
          <label className="text-muted text-[11px]">Fonte do título</label>
          <div className="grid grid-cols-2 gap-1.5">
            {['Padrão', 'Manuscrita', 'Estilo 1', 'Estilo 2'].map(f => (
              <button
                key={f}
                onClick={() => handleChange({ font: f })}
                className={`px-2 py-1 text-[11px] rounded border transition-all cursor-pointer ${
                  (ranking.font || 'Padrão') === f
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
              const ativo = (ranking.cor_titulo || 'Branco') === c.key
              return (
                <button
                  key={c.key}
                  onClick={() => handleChange({ cor_titulo: c.key })}
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

        {/* Altura do título */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-muted text-[11px]">Altura do título</label>
            <span className="text-accent text-[10px] font-mono">{titleYDraft}px</span>
          </div>
          <input
            type="range"
            min={50}
            max={1800}
            value={titleYDraft}
            onChange={e => handleTitleYChange(Number(e.target.value))}
            className="w-full accent-accent cursor-pointer"
          />
          <div className="flex justify-between text-muted text-[9px]">
            <span>Topo</span>
            <span>Base</span>
          </div>
        </div>

        {/* Altura da lista de itens */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-muted text-[11px]">Altura da lista de itens</label>
            <span className="text-accent text-[10px] font-mono">{itensYDraft}px</span>
          </div>
          <input
            type="range"
            min={50}
            max={1800}
            value={itensYDraft}
            onChange={e => handleItensYChange(Number(e.target.value))}
            className="w-full accent-accent cursor-pointer"
          />
          <div className="flex justify-between text-muted text-[9px]">
            <span>Topo</span>
            <span>Base</span>
          </div>
        </div>
        
        {/* Borda + sombra do título */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-accent w-3.5 h-3.5 cursor-pointer"
            checked={ranking.titulo_borda ?? true}
            onChange={e => handleChange({ titulo_borda: e.target.checked })}
          />
          <span className="text-muted text-[11px]">Borda e sombra preta no título</span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-xs text-muted">Máscara (Overlay Global)</label>
          <select
            value={ranking.overlay || 'nenhum'}
            onChange={e => handleChange({ overlay: e.target.value === 'nenhum' ? null : e.target.value })}
            className="w-full px-3 py-2 rounded-lg bg-card2 border border-border text-white text-sm outline-none focus:border-accent transition-colors"
          >
            <option value="nenhum">Nenhum</option>
            {overlays?.map(o => (
              <option key={o.id} value={o.id}>{o.id}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-xs text-muted">Transição</label>
          <div className="flex gap-1">
            {RANKING_TRANSICOES.map(t => (
              <button
                key={t}
                onClick={() => handleChange({ transicao_tipo: t })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all cursor-pointer ${
                  ranking.transicao_tipo === t
                    ? 'bg-accent/20 border-accent text-accent'
                    : 'border-border text-muted hover:border-accent hover:text-white'
                }`}
              >{t === 'nenhum' ? 'Nenhum' : t === 'flash' ? 'Flash' : t === 'zoom_corte' ? 'Zoom' : 'Glitch'}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Áudio: Efeito Sonoro & Trilha Sonora Viral */}
      <div className="pt-2 border-t border-border/50 space-y-3">
        <h3 className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
          <Volume2 size={13} className="text-accent" />
          <span>Efeitos Sonoros & Trilha Sonora</span>
        </h3>

        {/* Efeito Sonoro na Entrada / Transição dos Itens */}
        <div className="space-y-1.5">
          <label className="text-muted text-[11px] font-medium text-white">Efeito Sonoro por Ranking / Item</label>
          <select
            value={ranking.transicao_sfx ?? 'none'}
            onChange={e => handleChange({ transicao_sfx: e.target.value })}
            className="w-full bg-card2 border border-border rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent transition-colors cursor-pointer"
          >
            <option value="none">🔇 Sem efeito sonoro</option>
            <option value="whoosh">💨 Whoosh (transição rápida)</option>
            <option value="camera">📸 Câmera (flash)</option>
            <option value="click">🖱️ Click (rápido)</option>
            <option value="notificacao">🔔 Pop (notificação)</option>
          </select>
        </div>

        {/* Trilha Sonora Viral */}
        <div className="space-y-1.5">
          <label className="text-muted text-[11px] flex items-center gap-1 font-medium text-white">
            <Music size={12} className="text-accent" />
            <span>Trilha Sonora Viral</span>
          </label>
          <div className="space-y-1.5 bg-card/40 p-2 rounded-md border border-border/60">
            <select
              value={ranking.trilha_fundo ?? 'none'}
              onChange={e => handleChange({ trilha_fundo: e.target.value === 'none' ? null : e.target.value })}
              className="w-full bg-card2 border border-border rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-accent transition-colors cursor-pointer"
            >
              <option value="none">🔇 Sem música de fundo</option>
              {musicList.map(m => (
                <option key={m.id} value={m.file}>🎵 {m.label}</option>
              ))}
            </select>

            {ranking.trilha_fundo && ranking.trilha_fundo !== 'none' && (
              <div className="flex gap-1 pt-0.5">
                <button
                  onClick={() => handleChange({ trilha_modo: '100_musica' })}
                  className={`flex-1 py-1 px-1.5 rounded text-[10px] font-medium border transition-all cursor-pointer ${
                    (ranking.trilha_modo ?? '50_50') === '100_musica'
                      ? 'bg-accent/20 border-accent text-accent font-semibold'
                      : 'bg-card2 border-border text-muted hover:text-white'
                  }`}
                  title="Muta o áudio original do vídeo e toca apenas a música + narrações/SFX"
                >
                  100% Música (Sem Áudio Original)
                </button>
                <button
                  onClick={() => handleChange({ trilha_modo: '50_50' })}
                  className={`flex-1 py-1 px-1.5 rounded text-[10px] font-medium border transition-all cursor-pointer ${
                    ranking.trilha_modo === '50_50'
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
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted">Estilo legenda</label>
        <div className="flex flex-wrap gap-1">
          {RANKING_ESTILOS_LEGENDA.map(e => (
            <button
              key={e}
              onClick={() => handleChange({ legenda: { ...ranking.legenda, estilo: e } })}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all cursor-pointer ${
                ranking.legenda?.estilo === e
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'border-border text-muted hover:border-accent hover:text-white'
              }`}
            >{e.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-border accent-accent"
            checked={ranking.legenda?.ativa ?? false}
            onChange={e => handleChange({ legenda: { ...ranking.legenda, ativa: e.target.checked } })}
          />
          <span className="text-xs text-muted">Ativar legendas (Geral)</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-border accent-accent"
            checked={ranking.narrar_titulo_geral ?? false}
            onChange={e => handleChange({ narrar_titulo_geral: e.target.checked })}
          />
          <span className="text-xs text-muted">Narrar Título Geral</span>
        </label>
        
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-border accent-accent"
            checked={ranking.narrar_titulos_itens ?? false}
            onChange={e => handleChange({ narrar_titulos_itens: e.target.checked })}
          />
          <span className="text-xs text-muted">Narrar Títulos dos Itens (1 a 1)</span>
        </label>
        
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-border accent-accent"
            checked={ranking.legendar_titulo_geral ?? false}
            onChange={e => handleChange({ legendar_titulo_geral: e.target.checked })}
          />
          <span className="text-xs text-muted">Legendar Título Geral</span>
        </label>
      </div>
    </div>
  )
}