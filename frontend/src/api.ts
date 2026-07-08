// HTTP client for backend API

const BASE = ''   // proxy via vite → /api/*

export interface NarrationItem {
  id:          string
  text:        string
  start_sec:   number
  freeze?:     boolean
  legenda?:    boolean
  legenda_y?:  number
}

export interface VideoItem {
  id:         string
  url:        string
  title:      string
  /** Duração do vídeo em segundos (obtida via yt-dlp). */
  duration?:  number | null
  video_y?:   number
  overlay:    string
  /** Fonte do título (label de FONTS no backend). */
  font?:      string
  /** Altura vertical do título em px (maior = mais baixo). */
  title_y?:   number
  /** Filtro de vídeo: Nenhum | Suave | Preto e Branco. */
  filtro?:    string
  /** Cor do título (label de CORES_TITULO no backend). */
  cor_titulo?: string
  /** Borda preta + sombra no título (true = com borda). */
  titulo_borda?: boolean
  /** Tarja (caixa preta + texto) para cobrir marca d'água. */
  tarja?:     Tarja
  /** Se true, gera narração neural do título e mixa no clip final. */
  narrar_titulo?: boolean
  /** ID da voz para narração: 'padrao' (Piper) ou id de voz XTTS. */
  voice?: string
  /** Se true, trava o primeiro frame com som de notificação + narração do título (viral intro). */
  travar_inicio?: boolean
  /** Narrações personalizadas (texto + tempo de início). */
  narrations?: NarrationItem[]
  /** Se true, transcreve a fala e queima legenda animada (estilo TikTok). */
  gerar_legenda?: boolean
  /** Estilo da legenda: AMARELO_CLASSICO | POP_BRANCO | BOX_HORMOZI | NEON_VERDE. */
  estilo_legenda?: string
  /** Hook de 3s no início do vídeo. */
  hook_ativo?:   boolean
  hook_tipo?:    string
  hook_texto?:   string
  hook_som_entrada?: string
  hook_som_saida?:   string
  musica_fundo?: string
  musica_modo?:  string
  status:     string
  processado: boolean
  output_path?: string
  /** epoch ms — quando entrou em "processando" */
  started_at?:  number
  /** epoch ms — quando saiu com "concluido"/"erro" */
  finished_at?: number
  /** ms decorridos do start ao fim (definido após terminar) */
  elapsed_ms?:  number
  /** Progresso global estimado 0..1 dentro do vídeo atual. */
  progress?:    number
  /** Drive: fileId após upload bem-sucedido. */
  drive_id?:    string
  /** Drive: webViewLink (link clicável para o arquivo). */
  drive_url?:   string
  /** Mensagem de erro de upload, quando status='erro_upload'. */
  upload_error?: string
}

export interface Tarja {
  ativo: boolean
  x: number   // fração 0..1 (canto superior-esquerdo)
  y: number
  w: number   // fração 0..1 (largura/altura)
  h: number
  texto: string
}

export interface DriveStatus {
  credentials_present: boolean
  token_present:       boolean
  credentials_path:    string
  pasta_destino:       string
}

export interface ClipFile {
  filename: string
  size_mb:  number
  url:      string
}

export interface Pasta {
  id:               string
  nome:             string
  drive_link:       string
  drive_folder_id:  string
}

export interface PastasResponse {
  pastas:       Pasta[]
  selecionada:  Pasta | null
}

export interface GpuStatus {
  available: boolean
  codec:     string
  label:     string
}

export interface OverlayInfo {
  id:     string
  exists: boolean
  url:    string
}

export interface MusicItem {
  id:    string
  file:  string
  label: string
}

// ── Voz (serviço XTTS na porta 8095, proxy /voz) ──────────────────────────────

export interface VoiceInfo {
  id:      string
  speaker: string
  label:   string
  desc:    string
}

export interface VoiceHealth {
  ok:     boolean
  device: string
  loaded: boolean
  gpu:    string | null
}

export interface VoiceStyle {
  id:                string
  label:             string
  icon:              string
  desc:              string
  temperature:       number
  speed:             number
  repetition_penalty:number
  volume_db:         number
  warmth:            number
  clarity:           number
}

export interface VoiceGenParams {
  text:                string
  voice:               string
  temperature:         number
  speed:               number
  repetition_penalty:  number
  volume_db:           number
  warmth:              number
  polish:              boolean
  /** id do preset (ex.: 'naracao_youtube'). Se vier, sobrescreve os params acima. */
  style?:              string
  /** Injeta respiração sutil entre parágrafos. Padrão true. */
  breath?:             boolean
  /** Seed do torch. Se vier, mesma linha = mesma fala. */
  seed?:               number | null
  /** Processa tags Fish-style [pause], [emphasis], etc. */
  tags?:               boolean
  /** Aplica reverb de estúdio (room + early reflections). */
  studio_echo?:        boolean
  /** 'off' | 'light' | 'normal' | 'aggressive' */
  noise_level?:        'off' | 'light' | 'normal' | 'aggressive'
  /** Intensidade da mini-inteligência narrativa (0.0 = off, 1.0 = máximo). */
  intel_level?:        number
}

export interface NarrationVoice {
  id:    string
  label: string
  desc:  string
  tipo:  string
}

export interface IntelEnfase {
  pos_frac: number
  tipo: string
  intensidade: number
  ate_pontuacao: boolean
  motivo: string
}

export interface IntelPausa {
  pos_frac: number
  duracao_ms: number
  motivo: string
}

export interface IntelPreview {
  intensidade: number
  enfases: IntelEnfase[]
  pausas: IntelPausa[]
  marcadores_velocidade: { pos_frac: number; speed_mult: number; palavra: string }[]
  stats: Record<string, number>
  tempo_analise_ms: number
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body:    body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

// ── API ───────────────────────────────────────────────────────────────────────

export const api = {
  gpu:         ()                           => req<GpuStatus>('GET',    '/api/gpu'),
  getVideos:   ()                           => req<VideoItem[]>('GET',  '/api/videos'),
  addVideo:    (url: string, title?: string)=> req<{idx:number;video:VideoItem}>('POST', '/api/videos', { url, title }),
  deleteVideo: (idx: number)               => req<unknown>('DELETE', `/api/videos/${idx}`),
  updateVideo: (idx: number, patch: Partial<Pick<VideoItem,'title'|'video_y'|'overlay'|'font'|'title_y'|'filtro'|'cor_titulo'|'titulo_borda'|'tarja'|'narrar_titulo'|'travar_inicio'|'narrations'|'gerar_legenda'|'estilo_legenda'|'voice'|'hook_ativo'|'hook_tipo'|'hook_texto'|'hook_som_entrada'|'hook_som_saida'|'musica_fundo'|'musica_modo'>>) =>
                                              req<VideoItem>('PATCH', `/api/videos/${idx}`, patch),
  frameUrl:    (url: string) => `/api/frame?url=${encodeURIComponent(url)}`,
  search:      (tema: string, quantidade: number) =>
                                              req<{added:{idx:number;video:VideoItem}[];total:number}>('POST', '/api/search', { tema, quantidade }),
  process:     ()                           => req<{started:boolean;enfileirados:number;total:number}>('POST', '/api/process'),
  clips:       ()                           => req<ClipFile[]>('GET', '/api/clips'),
  overlays:    ()                           => req<OverlayInfo[]>('GET', '/api/overlays'),
  listMusic:   ()                           => req<MusicItem[]>('GET', '/api/music'),
  uploadOverlay: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/api/overlays`, { method: 'POST', body: fd })
    if (!res.ok) {
      let msg = `POST /api/overlays → ${res.status}`
      try { const j = await res.json(); if (j?.detail) msg = j.detail } catch { /* ignore */ }
      throw new Error(msg)
    }
    return res.json() as Promise<OverlayInfo>
  },
  deleteOverlay: (key: string)              => req<{ok:boolean;deleted:string}>('DELETE', `/api/overlays/${key}`),
  randomTitle: ()                           => req<{title:string}>('GET', '/api/titles/random'),
  // Pastas (destino do upload no Drive)
  listPastas:  ()                           => req<PastasResponse>('GET', '/api/pastas'),
  addPasta:    (nome: string, drive_link: string) => req<Pasta>('POST', '/api/pastas', { nome, drive_link }),
  deletePasta: (id: string)                 => req<{ok:boolean}>('DELETE', `/api/pastas/${id}`),
  selectPasta: (id: string)                 => req<{ok:boolean;pasta:Pasta|null}>('PUT', '/api/pastas/selecionada', { id }),
  // Drive
  driveStatus: ()                           => req<DriveStatus>('GET', '/api/drive/status'),
  retryUpload: (idx: number)                => req<{ok:boolean;drive_url?:string}>('POST', `/api/videos/${idx}/retry-upload`),
  deleteLocal: (idx: number)                => req<{ok:boolean}>('DELETE', `/api/videos/${idx}/local`),
  queueVideo:  (idx: number)                => req<{ok:boolean}>('POST', `/api/videos/${idx}/queue`),
  dequeueVideo:(idx: number)                => req<{ok:boolean}>('DELETE', `/api/videos/${idx}/queue`),
  // Voz
  voiceHealth:      ()                     => req<VoiceHealth>('GET', '/voz/health'),
  narrationVoices:  ()                     => req<NarrationVoice[]>('GET', '/api/narration-voices'),
  voices:      ()                           => req<VoiceInfo[]>('GET', '/voz/voices'),
  voiceStyles: ()                           => req<VoiceStyle[]>('GET', '/voz/styles'),
  intelPreview: (text: string, intensidade = 0.7) => {
    const u = new URLSearchParams({ text, intensidade: String(intensidade) })
    return req<IntelPreview>('GET', `/voz/intel/preview?${u.toString()}`)
  },
  generateVoice: async (p: VoiceGenParams): Promise<{ blob: Blob; genSeconds: number }> => {
    const res = await fetch(`${BASE}/voz/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(p),
    })
    if (!res.ok) {
      let msg = `POST /voz/generate → ${res.status}`
      try { const j = await res.json(); if (j?.detail) msg = j.detail } catch { /* ignore */ }
      throw new Error(msg)
    }
    const genSeconds = Number(res.headers.get('X-Gen-Seconds') ?? '0')
    return { blob: await res.blob(), genSeconds }
  },
}
