import { Plus } from 'lucide-react'
import { api } from '../api'
import type { Ranking } from '../api'

interface Props {
  onCreate: (r: Ranking) => void
  onToast: (msg: string, color?: 'green' | 'red' | 'yellow') => void
}

export default function RankingCreatePanel({ onCreate, onToast }: Props) {
  const handleCreate = async () => {
    try {
      const r = await api.createRanking()
      onCreate(r)
      onToast('Ranking criado')
    } catch (e) {
      onToast(`Erro ao criar: ${e}`, 'red')
    }
  }

  return (
    <button
      onClick={handleCreate}
      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-border text-muted hover:text-white hover:border-accent hover:bg-card2 transition-all cursor-pointer"
    >
      <Plus size={16} />
      <span className="text-sm font-medium">Novo Ranking</span>
    </button>
  )
}