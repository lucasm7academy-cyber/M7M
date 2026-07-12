import { Trash2, ExternalLink, Play, XCircle, BarChart3, Cloud, RefreshCw } from 'lucide-react'
import type { Ranking } from '../api'
import { api } from '../api'

const STATUS_EMOJI: Record<string, string> = {
  editando: '📝',
  na_fila: '⏳',
  processando: '⚙️',
  enviando_drive: '☁️',
  concluido: '✅',
  erro: '❌',
}

const STATUS_COLOR: Record<string, string> = {
  editando: 'text-muted',
  na_fila: 'text-muted',
  processando: 'text-warn',
  enviando_drive: 'text-accent',
  concluido: 'text-success',
  erro: 'text-danger',
}

interface Props {
  rankings: Ranking[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRefresh: () => void
}

export default function RankingList({ rankings, selectedId, onSelect, onDelete, onRefresh }: Props) {
  const handleQueue = async (id: string) => {
    try { await api.queueRanking(id); onRefresh() }
    catch (e) { alert(`Erro: ${e}`) }
  }
  const handleDequeue = async (id: string) => {
    try { await api.dequeueRanking(id); onRefresh() }
    catch (e) { alert(`Erro: ${e}`) }
  }
  const handleReprocess = async (id: string) => {
    try { await api.reprocessRanking(id); onRefresh() }
    catch (e) { alert(`Erro: ${e}`) }
  }

  const handleTestPreset = async () => {
    try {
      // 1. Create empty ranking
      const rk = await api.createRanking()
      
      // 2. Update with global preset data
      await api.updateRanking(rk.id, {
        titulo_geral: 'top 03',
        quantidade: 3,
        font: 'Padrão',
        overlay: '2'
      })
      
      // 3. Update items
      const links = [
        'https://www.youtube.com/shorts/Y2M5VeTJQz0',
        'https://www.youtube.com/shorts/uXm_oao5kRc',
        'https://www.youtube.com/shorts/Y2M5VeTJQz0'
      ]
      const titles = ['Primeiro', 'Segundo', 'Terceiro']
      
      for (let i = 1; i <= 3; i++) {
        await api.setRankingItem(rk.id, i, {
          link: links[i-1],
          titulo: titles[i-1]
        })
      }
      
      onRefresh()
      onSelect(rk.id)
    } catch (e) {
      alert(`Erro ao criar preset: ${e}`)
    }
  }

  return (
    <div className="flex-1 card flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
      <span className="text-white font-semibold text-sm">
        Rankings {rankings.length > 0 && (
          <span className="ml-2 px-2 py-0.5 bg-accent/20 text-accent text-xs rounded-full">{rankings.length}</span>
        )}
      </span>
      <div className="flex items-center gap-2">
        <button onClick={handleTestPreset} className="text-accent hover:text-white transition-colors cursor-pointer text-xs bg-accent/10 px-2 py-1 rounded" title="Criar Preset de Teste">
          TESTE
        </button>
        <button onClick={onRefresh} className="text-muted hover:text-white transition-colors cursor-pointer" title="Atualizar">
          <BarChart3 size={14} />
        </button>
      </div>
    </div>

    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
      {rankings.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full py-16 text-center">
          <span className="text-4xl mb-3">🏆</span>
          <p className="text-muted text-sm">Nenhum ranking.</p>
          <p className="text-muted text-xs mt-1">Crie um ranking Top N para começar.</p>
        </div>
      ) : (
        rankings.map(r => {
          const selected = r.id === selectedId
          const statusKey = r.status || 'editando'
          return (
            <div
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                selected ? 'bg-card2 border-accent' : 'bg-transparent border-transparent hover:bg-card2 hover:border-border'
              }`}
            >
              <span className="text-base shrink-0">{STATUS_EMOJI[statusKey] ?? '📝'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate flex items-center gap-1.5">
                  {r.titulo_geral || 'Ranking sem título'}
                  {r.drive_url && <Cloud size={12} className="text-success shrink-0" />}
                </p>
                <p className={`text-xs truncate ${STATUS_COLOR[statusKey] ?? 'text-muted'}`}>
                  {r.ordem === 'decrescente' ? 'Top → baixo' : 'Baixo → Top'} · {r.itens.length}/{r.quantidade} itens
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {r.drive_url && (
                  <button onClick={e => { e.stopPropagation(); window.open(r.drive_url, '_blank') }}
                    className="p-1 text-success hover:text-white transition-colors" title="Abrir no Google Drive">
                    <Cloud size={13} />
                  </button>
                )}
                {statusKey === 'editando' && !r.processado && (
                  <button onClick={e => { e.stopPropagation(); handleQueue(r.id) }}
                    className="p-1 text-accent hover:text-white transition-colors" title="Adicionar à fila">
                    <Play size={13} />
                  </button>
                )}
                {statusKey === 'na_fila' && !r.processado && (
                  <button onClick={e => { e.stopPropagation(); handleDequeue(r.id) }}
                    className="p-1 text-warn hover:text-white transition-colors" title="Remover da fila">
                    <XCircle size={13} />
                  </button>
                )}
                {(statusKey === 'concluido' || statusKey === 'erro' || statusKey === 'erro_upload') && (
                  <button onClick={e => { e.stopPropagation(); handleReprocess(r.id) }}
                    className="p-1 text-accent hover:text-white transition-colors" title="Reprocessar">
                    <RefreshCw size={13} />
                  </button>
                )}
                <button onClick={e => { e.stopPropagation(); onDelete(r.id) }}
                  className="p-1 text-muted hover:text-danger transition-colors" title="Excluir ranking">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })
      )}
    </div>
  </div>
  )
}