import { useEffect, useRef, useState } from 'react'
import {
  Mic2, Play, Loader2, Download, Sparkles, Zap, Cpu,
  Film, BookOpen, GraduationCap, Flame, Mic, Sliders, Info,
} from 'lucide-react'
import { api, type VoiceInfo, type VoiceHealth, type VoiceStyle } from '../api'

// Mapa nome-do-ícone (vindo do backend) → componente lucide.
const ICONE: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  film: Film, book: BookOpen, graduation: GraduationCap,
  zap: Zap, flame: Flame, mic: Mic,
}

interface Props {
  onToast?: (msg: string, color?: 'green' | 'red' | 'yellow') => void
}

const EXEMPLO =
  'No ano seguinte, Arcade poupou novamente, mas, em vez de investir, ' +
  'gastou tudo em roupas finas e banquetes. Ao contar isso a Algamish, ' +
  'ouviu a severa repreensão de que estava "comendo os filhos de sua ' +
  'poupança", ou seja, consumindo o capital que poderia gerar mais ' +
  'riqueza em vez de fazê-lo trabalhar para si.'

export default function VoicePanel({ onToast }: Props) {
  const [voices,  setVoices]  = useState<VoiceInfo[]>([])
  const [voice,   setVoice]   = useState<string>('')
  const [text,    setText]    = useState<string>(EXEMPLO)
  const [health,  setHealth]  = useState<VoiceHealth | null>(null)

  // Presets de narração (carregados do /voz/styles). selectedStyle='' = manual.
  const [styles,         setStyles]         = useState<VoiceStyle[]>([])
  const [selectedStyle,  setSelectedStyle]  = useState<string>('naracao_youtube')

  const [temperature, setTemperature] = useState(0.50)
  const [speed,       setSpeed]       = useState(0.95)
  const [repPen,      setRepPen]      = useState(8.0)
  const [volumeDb,    setVolumeDb]    = useState(1.0)
  const [warmth,      setWarmth]      = useState(0.08)
  const [polish,      setPolish]      = useState(true)
  const [breath,      setBreath]      = useState(true)
  const [studioEcho,  setStudioEcho]  = useState(false)
  const [tags,        setTags]        = useState(true)
  const [intelLevel,  setIntelLevel]  = useState(0.7)

  const [loading,  setLoading]  = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [lastGen,  setLastGen]  = useState<number | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  const audioUrlRef = useRef<string | null>(null)

  // Carrega vozes + status do serviço; faz polling do health até o modelo subir.
  useEffect(() => {
    api.voices().then(vs => {
      setVoices(vs)
      if (vs.length) setVoice(prev => prev || vs[0].id)
    }).catch(() => setError('Serviço de voz offline (porta 8095). Rode o voice_server.py.'))

    // Presets: aplica o default (Narração YouTube) nos sliders quando o servidor responde.
    api.voiceStyles().then(ss => {
      setStyles(ss)
      const def = ss.find(s => s.id === 'naracao_youtube') ?? ss[0]
      if (def) aplicarPreset(def)
    }).catch(() => { /* presets indisponíveis -> usuário fica no modo manual */ })

    let timer: number | undefined
    const tick = () => {
      api.voiceHealth()
        .then(h => {
          setHealth(h)
          if (!h.loaded) timer = window.setTimeout(tick, 3000)
        })
        .catch(() => { timer = window.setTimeout(tick, 4000) })
    }
    tick()
    return () => { if (timer) window.clearTimeout(timer) }
  }, [])

  // Libera o object URL anterior ao desmontar.
  useEffect(() => () => { if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current) }, [])

  function aplicarPreset(p: VoiceStyle) {
    setTemperature(p.temperature)
    setSpeed(p.speed)
    setRepPen(p.repetition_penalty)
    setVolumeDb(p.volume_db)
    setWarmth(p.warmth)
  }

  async function gerar() {
    const t = text.trim()
    if (!t) { setError('Digite um texto'); return }
    if (!voice) { setError('Selecione uma voz'); return }
    setLoading(true); setError(null)
    try {
      const { blob, genSeconds } = await api.generateVoice({
        text: t, voice, temperature, speed, repetition_penalty: repPen,
        volume_db: volumeDb, warmth, polish, breath,
        tags, studio_echo: studioEcho, intel_level: intelLevel,
        style: selectedStyle || undefined,
      })
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      const url = URL.createObjectURL(blob)
      audioUrlRef.current = url
      setAudioUrl(url)
      setLastGen(genSeconds)
      onToast?.(`Voz gerada em ${genSeconds.toFixed(1)}s`, 'green')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      onToast?.(`Erro: ${msg}`, 'red')
    } finally {
      setLoading(false)
    }
  }

  const modeloPronto = health?.loaded === true

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-5xl mx-auto grid grid-cols-[320px_1fr] gap-4">

        {/* ── Coluna de configuração ── */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-4 h-fit">
          <div className="flex items-center gap-2">
            <Mic2 size={16} className="text-accent" />
            <h2 className="text-white font-semibold text-sm">Vozes</h2>
          </div>

          {/* Status do serviço */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border ${
            health
              ? (modeloPronto ? 'bg-success/10 text-success border-success/30' : 'bg-warn/10 text-warn border-warn/30')
              : 'bg-danger/10 text-danger border-danger/30'
          }`}>
            {health?.device === 'cuda' ? <Zap size={12} /> : <Cpu size={12} />}
            {!health ? 'Serviço offline'
              : modeloPronto ? `Pronto · ${health.gpu ?? health.device}`
              : 'Carregando modelo…'}
          </div>

          {/* Estilos pré-programados */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted text-[11px]">Estilo de narração</span>
              {selectedStyle && (
                <button
                  onClick={() => setSelectedStyle('')}
                  className="flex items-center gap-1 text-[10px] text-muted hover:text-white transition-colors cursor-pointer"
                  title="Desmarcar preset e usar os sliders manualmente"
                >
                  <Sliders size={10} /> Manual
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {styles.map(s => {
                const Icone = ICONE[s.icon] ?? Mic2
                const ativo = selectedStyle === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedStyle(s.id); aplicarPreset(s) }}
                    title={`${s.desc}\nTemp ${s.temperature} · Vel ${s.speed}x · Rep ${s.repetition_penalty}`}
                    className={`flex items-start gap-1.5 px-2 py-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                      ativo
                        ? 'bg-accent/20 border-accent text-accent'
                        : 'bg-card2 border-border text-muted hover:text-white hover:border-muted'
                    }`}
                  >
                    <Icone size={12} className="mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold leading-tight truncate">{s.label}</div>
                      <div className="text-[9px] leading-tight opacity-80 truncate">{s.desc}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Seletor de voz */}
          <div className="grid grid-cols-2 gap-1.5">
            {voices.map(v => (
              <button
                key={v.id}
                onClick={() => setVoice(v.id)}
                title={v.desc}
                className={`flex flex-col items-start px-2.5 py-2 rounded-lg border transition-all cursor-pointer ${
                  voice === v.id
                    ? 'bg-accent/20 border-accent text-accent'
                    : 'bg-card2 border-border text-muted hover:text-white hover:border-muted'
                }`}
              >
                <span className="text-xs font-semibold leading-tight">{v.label}</span>
                <span className="text-[9px] leading-tight opacity-80">{v.desc}</span>
              </button>
            ))}
          </div>

          {/* Sliders */}
          <Slider label="Variação de tom" value={temperature} min={0.0} max={0.95} step={0.05}
            onChange={setTemperature} hintMin="Estável/natural" hintMax="Solta (fica fininho)" fmt={v => v.toFixed(2)} />
          <Slider label="Naturalidade" value={repPen} min={0.0} max={10} step={0.5}
            onChange={setRepPen} hintMin="Mínimo" hintMax="Natural" fmt={v => v.toFixed(1)} />
          <Slider label="Velocidade" value={speed} min={0.7} max={1.4} step={0.05}
            onChange={setSpeed} hintMin="Lenta" hintMax="Rápida" fmt={v => `${v.toFixed(2)}x`} />
          <Slider label="Volume" value={volumeDb} min={-6} max={6} step={0.5}
            onChange={setVolumeDb} hintMin="-6dB" hintMax="+6dB" fmt={v => `${v > 0 ? '+' : ''}${v} dB`} />
          <Slider label="Calor (reverb)" value={warmth} min={0} max={0.4} step={0.02}
            onChange={setWarmth} hintMin="Seco" hintMax="Ambiente" fmt={v => v.toFixed(2)} />

          {/* Polimento + Respiração + Eco */}
          <div className="space-y-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" className="accent-accent w-3.5 h-3.5 cursor-pointer"
                checked={polish} onChange={e => setPolish(e.target.checked)} />
              <span className="text-muted text-[11px]">Polir áudio (EQ + compressor)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none" title="Injeta uma respiração sutil antes de cada pausa longa — soa mais humano">
              <input type="checkbox" className="accent-accent w-3.5 h-3.5 cursor-pointer"
                checked={breath} onChange={e => setBreath(e.target.checked)} />
              <span className="text-muted text-[11px]">Respiração entre parágrafos</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none" title="Adiciona reverb de sala + reflexos iniciais — sensação de estúdio tratado">
              <input type="checkbox" className="accent-accent w-3.5 h-3.5 cursor-pointer"
                checked={studioEcho} onChange={e => setStudioEcho(e.target.checked)} />
              <span className="text-muted text-[11px]">Eco de estúdio</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none" title="Processa tags Fish Audio [pause], [emphasis], etc.">
              <input type="checkbox" className="accent-accent w-3.5 h-3.5 cursor-pointer"
                checked={tags} onChange={e => setTags(e.target.checked)} />
              <span className="text-muted text-[11px]">Tags Fish-style no texto</span>
            </label>
          </div>

          {/* Inteligência narrativa */}
          <div className="space-y-1 pt-1 border-t border-border">
            <div className="flex items-center justify-between">
              <label className="text-muted text-[11px]" title="Detecta verbos (sussurrou/gritou), palavras de peso, exclamações, ALL CAPS, starters de história e aplica ênfase/sussurro/pausa SUTILMENTE no áudio.">
                Inteligência narrativa
              </label>
              <span className="text-accent text-[10px] font-mono">{Math.round(intelLevel * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.05} value={intelLevel}
              onChange={e => setIntelLevel(Number(e.target.value))}
              className="w-full accent-accent cursor-pointer"
            />
            <div className="flex justify-between text-muted text-[9px]">
              <span>Desligado</span><span>Equilíbrio</span><span>Máximo</span>
            </div>
          </div>
        </div>

        {/* ── Coluna principal: texto + player ── */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3 flex flex-col">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold text-sm">Texto</h2>
            <button
              onClick={() => setText(EXEMPLO)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-card2 border border-border text-muted hover:text-white hover:border-muted transition-all cursor-pointer"
              title="Preencher com um exemplo de narração"
            >
              <Sparkles size={11} /> Exemplo
            </button>
          </div>

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Digite o texto que a voz vai narrar… (use acentuação correta para melhor pronúncia)"
            className="w-full h-56 resize-y bg-card2 border border-border rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-accent transition-colors leading-relaxed"
          />
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span>{text.trim().length} caracteres</span>
            <span>Acentos = pronúncia melhor</span>
          </div>

          {/* Dica das tags Fish-style */}
          <details className="text-[10px] text-muted bg-card2/50 rounded-lg border border-border">
            <summary className="cursor-pointer px-2 py-1.5 flex items-center gap-1.5 hover:text-white transition-colors">
              <Info size={10} />
              Tags Fish-style — use no texto
            </summary>
            <div className="px-2.5 pb-2 pt-1 space-y-1 leading-relaxed">
              <div><span className="text-accent font-mono">[pause]</span>, <span className="text-accent font-mono">[short pause]</span>, <span className="text-accent font-mono">[long pause]</span> — silencios</div>
              <div><span className="text-accent font-mono">[emphasis]</span> — trecho mais alto e nítido</div>
              <div><span className="text-accent font-mono">[whisper]</span> — sussurro (baixo + ar)</div>
              <div><span className="text-accent font-mono">[shout]</span> — grito (mais presença)</div>
              <div><span className="text-accent font-mono">[soft]</span> — voz suave (sem agudos)</div>
              <div><span className="text-accent font-mono">[inhale]</span> / <span className="text-accent font-mono">[exhale]</span> — respiração audível</div>
              <div><span className="text-accent font-mono">[laugh]</span> — risada</div>
              <div className="text-muted/80 italic pt-1">
                Ex.: "Ele se virou [pause] e viu a verdade [emphasis] que sempre esteve ali."
              </div>
            </div>
          </details>

          <button
            onClick={gerar}
            disabled={loading || !text.trim()}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-all ${
              loading || !text.trim()
                ? 'bg-muted/30 text-muted cursor-not-allowed'
                : 'bg-accent hover:bg-accent/80 text-white cursor-pointer'
            }`}
          >
            {loading
              ? <><Loader2 size={16} className="animate-spin" /> Gerando…</>
              : <><Play size={16} /> Gerar voz</>}
          </button>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs">
              {error}
            </div>
          )}

          {/* Player */}
          {audioUrl && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-muted text-[11px]">
                  Resultado{lastGen != null ? ` · gerado em ${lastGen.toFixed(1)}s` : ''}
                </span>
                <a
                  href={audioUrl}
                  download="voz.wav"
                  className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md bg-card2 border border-border text-muted hover:text-white hover:border-muted transition-all cursor-pointer"
                >
                  <Download size={11} /> Baixar WAV
                </a>
              </div>
              <audio key={audioUrl} src={audioUrl} controls autoPlay className="w-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Slider reutilizável ───────────────────────────────────────────────────────
interface SliderProps {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; hintMin: string; hintMax: string
  fmt: (v: number) => string
}
function Slider({ label, value, min, max, step, onChange, hintMin, hintMax, fmt }: SliderProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-muted text-[11px]">{label}</label>
        <span className="text-accent text-[10px] font-mono">{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-accent cursor-pointer"
      />
      <div className="flex justify-between text-muted text-[9px]">
        <span>{hintMin}</span><span>{hintMax}</span>
      </div>
    </div>
  )
}
