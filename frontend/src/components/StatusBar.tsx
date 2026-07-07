interface Props {
  message: string
  color?:  'green' | 'yellow' | 'red'
}

const colors = {
  green:  'text-success',
  yellow: 'text-warn',
  red:    'text-danger',
}

export default function StatusBar({ message, color = 'green' }: Props) {
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-card rounded-xl border border-border">
      <span className={`text-base ${colors[color]} animate-pulse-dot`}>●</span>
      <span className="text-sm text-slate-300">{message}</span>
    </div>
  )
}
