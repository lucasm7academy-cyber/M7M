import { Cpu, Zap, PlayCircle, Loader2, FolderOpen, ChevronDown, Clapperboard } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { api, type Pasta, type GpuStatus } from '../api'

interface Props {
  gpu:          GpuStatus | null
  processing:   boolean
  queueCount:   number
  onProcess:    () => void
  onOpenPastas: () => void
  pastaVersion: number
}

export default function Header({ gpu, processing, queueCount, onProcess, onOpenPastas, pastaVersion }: Props) {
  const [pastaAtual, setPastaAtual] = useState<Pasta | null>(null)
  const [pastas, setPastas] = useState<Pasta[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    load()
  }, [pastaVersion])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function load() {
    const res = await api.listPastas().catch(() => ({ pastas: [], selecionada: null }))
    setPastas(res.pastas)
    setPastaAtual(res.selecionada)
  }

  async function handleSelect(p: Pasta) {
    await api.selectPasta(p.id)
    setPastaAtual(p)
    setOpen(false)
  }

  return (
    <header className="flex items-center justify-between px-6 h-16 bg-card/80 backdrop-blur border-b border-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <img src="/logo-m7.png" alt="M7 Logo" className="w-9 h-9 object-contain rounded-xl shadow-glow" />
        <div>
          <h1 className="text-white font-bold text-lg leading-none tracking-tight">MoviePy <span className="text-accent">Studio</span></h1>
          <p className="text-muted text-[11px] mt-0.5">Download · Overlay · Título · Narração</p>
        </div>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-3">
        {/* Botão Pastas */}
        <div className="relative" ref={ref}>
          <button
            onClick={() => { load(); setOpen(!open) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card2 hover:border-muted text-muted hover:text-white text-xs font-medium transition-all cursor-pointer"
          >
            <FolderOpen size={13} />
            <span className="max-w-[100px] truncate">{pastaAtual?.nome ?? 'Pastas'}</span>
            <ChevronDown size={11} />
          </button>
          {open && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-card border border-border rounded-lg shadow-xl z-40 py-1 max-h-48 overflow-y-auto">
              {pastas.length === 0 && (
                <p className="text-muted text-[10px] text-center py-3">Nenhuma pasta</p>
              )}
              {pastas.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleSelect(p)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-all cursor-pointer ${
                    pastaAtual?.id === p.id
                      ? 'bg-accent/15 text-accent'
                      : 'text-muted hover:text-white hover:bg-card2'
                  }`}
                >
                  <FolderOpen size={12} />
                  <span className="flex-1 truncate">{p.nome}</span>
                  {pastaAtual?.id === p.id && <span className="text-[8px] uppercase tracking-wider bg-accent/30 px-1 rounded">atual</span>}
                </button>
              ))}
              <div className="border-t border-border mt-1 pt-1">
                <button
                  onClick={() => { setOpen(false); onOpenPastas() }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-accent hover:bg-card2 transition-all cursor-pointer"
                >
                  <span className="text-base leading-none">+</span>
                  Gerenciar pastas
                </button>
              </div>
            </div>
          )}
        </div>

        {gpu && (
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
            gpu.available
              ? 'bg-success/10 text-success border-success/30'
              : 'bg-muted/10 text-muted border-muted/30'
          }`}>
            {gpu.available ? <Zap size={12} /> : <Cpu size={12} />}
            {gpu.label}
          </div>
        )}

        <button
          onClick={onProcess}
          disabled={processing || queueCount === 0}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm transition-all ${
            processing || queueCount === 0
              ? 'bg-muted/30 text-muted cursor-not-allowed'
              : 'bg-brand-gradient hover:opacity-90 text-white shadow-glow cursor-pointer'
          }`}
        >
          {processing
            ? <><Loader2 size={15} className="animate-spin" /> Processando…</>
            : <><PlayCircle size={15} /> PROCESSAR {queueCount > 0 ? `(${queueCount})` : 'TODOS'}</>
          }
        </button>
      </div>
    </header>
  )
}
