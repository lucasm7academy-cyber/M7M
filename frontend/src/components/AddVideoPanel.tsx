import { useState } from 'react'
import { Plus, Search, Loader2 } from 'lucide-react'

interface Props {
  onAddUrl:    (url: string) => Promise<void>
  onSearch:    (tema: string, qtd: number) => Promise<void>
  searching:   boolean
}

export default function AddVideoPanel({ onAddUrl, onSearch, searching }: Props) {
  const [url,   setUrl]   = useState('')
  const [tema,  setTema]  = useState('league of legends')
  const [qtd,   setQtd]   = useState(3)
  const [adding, setAdding] = useState(false)

  async function handleAdd() {
    if (!url.trim()) return
    setAdding(true)
    await onAddUrl(url.trim())
    setUrl('')
    setAdding(false)
  }

  return (
    <div className="card p-5 space-y-4">
      <h2 className="text-white font-semibold text-sm">Adicionar vídeos</h2>

      {/* URL direta */}
      <div className="flex gap-2">
        <input
          className="flex-1 bg-card2 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-accent transition-colors"
          placeholder="https://youtube.com/watch?v=..."
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          onDrop={e => { e.preventDefault(); setUrl(e.dataTransfer.getData('text')) }}
          onDragOver={e => e.preventDefault()}
        />
        <button
          onClick={handleAdd}
          disabled={adding || !url.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent2 hover:bg-accent2/80 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Adicionar
        </button>
      </div>

      {/* Divisor */}
      <div className="border-t border-border" />

      {/* Busca viral */}
      <div className="flex gap-2">
        <input
          className="flex-1 bg-card2 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-accent transition-colors"
          placeholder="Tema para buscar..."
          value={tema}
          onChange={e => setTema(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSearch(tema, qtd)}
        />
        <input
          type="number"
          min={1} max={20}
          className="w-16 bg-card2 border border-border rounded-lg px-3 py-2 text-sm text-white text-center outline-none focus:border-accent transition-colors"
          value={qtd}
          onChange={e => setQtd(Number(e.target.value))}
        />
        <button
          onClick={() => onSearch(tema, qtd)}
          disabled={searching || !tema.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-card2 hover:bg-border disabled:opacity-40 text-white text-sm font-medium rounded-lg border border-border transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Buscar
        </button>
      </div>
    </div>
  )
}
