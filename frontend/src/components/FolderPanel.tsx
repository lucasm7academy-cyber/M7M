import { useState, useEffect } from 'react'
import { X, Plus, ExternalLink, Trash2, FolderOpen } from 'lucide-react'
import { api, type Pasta } from '../api'

interface Props {
  open: boolean
  onClose: () => void
  onChanged?: () => void
  onToast?: (msg: string, color?: 'green' | 'red' | 'yellow') => void
}

export default function FolderPanel({ open, onClose, onChanged, onToast }: Props) {
  const [pastas, setPastas] = useState<Pasta[]>([])
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) load()
  }, [open])

  async function load() {
    const res = await api.listPastas().catch(() => ({ pastas: [], selecionada: null }))
    setPastas(res.pastas)
    setSelecionadaId(res.selecionada?.id ?? null)
  }

  async function handleAdd() {
    if (!nome.trim() || !link.trim()) {
      onToast?.('Preencha nome e link da pasta', 'red')
      return
    }
    setBusy(true)
    try {
      await api.addPasta(nome.trim(), link.trim())
      setNome('')
      setLink('')
      onToast?.('Pasta adicionada', 'green')
      await load()
      onChanged?.()
    } catch {
      onToast?.('Erro ao adicionar pasta. Use um link do tipo drive.google.com/drive/folders/XXX', 'red')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover esta pasta?')) return
    setBusy(true)
    try {
      await api.deletePasta(id)
      onToast?.('Pasta removida', 'yellow')
      await load()
      onChanged?.()
    } catch {
      onToast?.('Erro ao remover pasta', 'red')
    } finally {
      setBusy(false)
    }
  }

  async function handleSelect(id: string) {
    await api.selectPasta(id)
    setSelecionadaId(id)
    onChanged?.()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="card w-[440px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FolderOpen size={16} className="text-accent" />
            <h2 className="text-white font-semibold text-sm">Pastas do Drive</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {pastas.length === 0 && (
            <p className="text-muted text-xs text-center py-6">
              Nenhuma pasta cadastrada. Adicione uma abaixo.
            </p>
          )}
          {pastas.map(p => (
            <div
              key={p.id}
              onClick={() => handleSelect(p.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                selecionadaId === p.id
                  ? 'bg-accent/15 border-accent text-accent'
                  : 'bg-card2 border-border text-muted hover:text-white hover:border-muted'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{p.nome}</span>
                  {selecionadaId === p.id && (
                    <span className="text-[9px] uppercase tracking-wider bg-accent/30 px-1.5 py-0.5 rounded font-semibold">Atual</span>
                  )}
                </div>
                <a
                  href={p.drive_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-[10px] text-muted hover:text-accent flex items-center gap-1 mt-0.5 truncate"
                >
                  <ExternalLink size={9} />
                  {p.drive_link}
                </a>
              </div>
              <button
                onClick={e => { e.stopPropagation(); handleDelete(p.id) }}
                disabled={busy}
                className="text-muted hover:text-red-400 disabled:opacity-40 cursor-pointer shrink-0"
                title="Remover pasta"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        {/* Adicionar */}
        <div className="px-5 py-4 border-t border-border space-y-2">
          <input
            className="w-full bg-card2 border border-border rounded-md px-3 py-2 text-xs text-white outline-none focus:border-accent transition-colors placeholder:text-muted"
            placeholder="Nome da pasta (ex: Clips Segunda-Feira)"
            value={nome}
            onChange={e => setNome(e.target.value)}
          />
          <div className="flex gap-2">
            <input
              className="flex-1 min-w-0 bg-card2 border border-border rounded-md px-3 py-2 text-xs text-white outline-none focus:border-accent transition-colors placeholder:text-muted"
              placeholder="Link do Drive (folders/XXX)"
              value={link}
              onChange={e => setLink(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <button
              onClick={handleAdd}
              disabled={busy || !nome.trim() || !link.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent hover:bg-accent/80 text-white text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
            >
              <Plus size={13} />
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
