# MoviePy Studio — Documentação de Funcionamento

Ferramenta desktop/servidor para transformar vídeos do YouTube/Instagram em **clips verticais (9:16) estilo TikTok/Reels/Shorts**, com overlay, título animado, narração neural, legenda automática palavra a palavra e hook de retenção — e envio automático para o Google Drive.

---

## 1. Visão geral

O MoviePy Studio é dividido em duas partes que se comunicam por HTTP + WebSocket:

| Camada | Tecnologia | Onde |
|--------|-----------|------|
| **Backend** | Python · FastAPI · MoviePy · ffmpeg · faster-whisper · Piper/XTTS | `backend/` + `main.py` |
| **Frontend** | React 19 · Vite · TypeScript · Tailwind | `frontend/` |
| **Voz (serviço separado)** | Fish Audio / XTTS v2 (porta 8095) | servidor externo `voice_server` |

O backend roda na porta **8090** (`uvicorn`, host `0.0.0.0`). O frontend (Vite, porta 5173 em dev) acessa o backend via proxy `/api/*` e o serviço de voz via `/voz/*`. O progresso em tempo real chega pelo WebSocket `/ws/progress`.

---

## 2. Estrutura de pastas

```
moviepy/
├── main.py                 # API FastAPI (rotas, WebSocket, estado em memória)
├── config.py               # Constantes: resolução, fontes, cores, filtros, hooks
├── video_processor.py      # Pipeline de edição (download → edita → exporta)
├── subtitles.py            # Legendas automáticas (whisper + ASS)
├── narration.py            # Narração neural (Piper local + XTTS remoto)
├── drive_uploader.py       # Upload para o Google Drive (OAuth)
├── viral_fetcher.py        # Busca de Shorts virais no YouTube
├── download_musicas.py     # Script utilitário p/ baixar trilhas virais
├── pastas.py               # Gerencia pastas de destino no Drive
├── backend/                # (mesmos módulos acima vivem aqui em runtime)
├── frontend/               # App React
├── clips/                  # Saída final (.mp4 dos clips prontos)
├── downloads/              # Vídeos crus baixados (limpos após upload)
├── frames/                 # Cache de frames para o preview
├── music/                  # Trilhas sonoras de fundo (.mp3)
├── sfx/                    # Efeitos sonoros (whoosh, camera, click, notificacao)
├── overlay1.png …          # Imagens de overlay (lidas dinamicamente)
├── cookies.txt             # Cookies do YouTube (opcional, p/ evitar bloqueios)
├── docker-compose.yml      # Orquestração Docker
├── INICIAR_APP.bat / RESTART_APP.bat
└── README.md
```

Resolução alvo: **1080×1920** (9:16). Definida em `config.WIDTH/HEIGHT`.

---

## 3. Como executar

- **Docker:** `docker-compose up` (sobe backend + frontend conforme o compose).
- **Windows direto:**
  - Backend: `python main.py` (porta 8090).
  - Frontend: `cd frontend && npm install && npm run dev` (porta 5173).
  - Voz: serviço XTTS/Fish Audio na porta 8095 (separado).
- **Atalhos:** `INICIAR_APP.bat` / `RESTART_APP.bat`.

Dependências externas: **ffmpeg/ffprobe** no PATH, **Piper** (`C:\Piper\...`) para narração local, e credenciais do Google Drive em `C:\Users\78787\.gdrive\`.

---

## 4. Fluxo do usuário (Frontend)

1. **Adicionar vídeos** (`AddVideoPanel`)
   - URL direta (YouTube/Instagram) → `POST /api/videos`
   - **Busca viral** por tema + quantidade → `POST /api/search` (usa `viral_fetcher`)
2. **Fila** (`VideoQueue`) — lista com status: `editando → na_fila → processando → enviando_drive → concluido`. Ações: colocar/tirar da fila, abrir no YouTube/Drive, retry de upload, apagar.
3. **Configurar por vídeo** (`ConfigPanel` + `PreviewPanel`)
   - Título (fonte, cor, borda, altura) + botão de título aleatório
   - Posição do vídeo (slider `video_y`) e **overlay PNG** (upload/exclusão)
   - Filtro (Suave / P&B), **narração do título**, **narrações personalizadas**
   - **Legenda automática TikTok** (4 estilos) via whisper
   - **Hook de 3s** (gancho com texto, estilo visual e SFX de entrada/saída)
   - **Trilha sonora viral** (música de fundo, 100% música ou mix)
   - **Tarja** arrastável no preview para cobrir marca d'água
   - O `PreviewPanel` é um "telefone" 9:16 que espelha o backend em tempo real (thumbnail do YouTube → frame real, título posicionado, legenda, badge de narração).
4. **Processar** (Header) → `POST /api/process`: o backend baixa, edita, exporta e sobe para o Drive (pasta selecionada em `FolderPanel`).
5. **Progresso** (`ProgressPanel`) — barras por vídeo, cronômetro ao vivo, ETA e tempo total do lote (via WebSocket).
6. **Aba Voz** (`VoicePanel`) — gerador independente de narração (XTTS na 8095): escolhe voz/preset, ajusta tom/velocidade/calor/inteligência narrativa, tags Fish-style, e ouve o WAV gerado.

---

## 5. Pipeline de processamento (Backend)

Tudo começa no **worker contínuo** `_background_queue_worker` (iniciado no startup). Ele varre `lista_videos` e processa, um a um, tudo que estiver com `status == "na_fila"`. Para cada vídeo:

### 5.1 Ingestão
- `baixar_video()` (video_processor) usa **yt-dlp** para baixar o melhor MP4 (merge de vídeo+áudio). Se `cookies.txt` existir, é usado para evitar bloqueios.
- O hook de progresso do download alimenta o evento `progress` (fase `baixando`) no WebSocket.
- A duração é obtida por `obter_duracao()` (yt-dlp, sem download) e exibida na fila.

### 5.2 Busca viral (`viral_fetcher.buscar_videos_virais`)
- Busca **Shorts do YouTube (≤ 60s)** sobre o tema, em 3 fontes (hashtag/shorts, busca filtrada, ytsearch).
- **Filtro de relevância:** só aceita vídeos cujo título contenha ao menos um token significativo do tema.
- **Validação rígida:** confirma URL canônica `/shorts/<id>` (SEM redirect) **E** duração ≤ 60s. Ambas obrigatórias.
- **Blacklist** (`usados.txt`): nunca repete um vídeo já usado.

### 5.3 Conversão para vertical (`to_vertical`)
- Vídeo redimensionado para caber em 1080×1920 (`VIDEO_SCALE_RATIO_VERTICAL = 0.937`), centralizado sobre fundo preto.
- O slider `video_y` desloca o vídeo verticalmente (positivo = desce/revela topo; negativo = sobe/revela base).

### 5.4 Título (`gerar_titulo_clip`)
- `TextClip` com fonte escolhida (Padrão/Manuscrita/Estilo 1/Estilo 2), cor, borda preta/sombra e altura ajustável (`title_y`).
- Botão "título aleatório" usa `proximo_titulo()` (lista cíclica em `config.TITULOS_PADRAO`).

### 5.5 Overlay
- Imagens `overlay<N>.png` na raiz são descobertas em runtime (`config.OVERLAYS`). O usuário seleciona qual sobrepõe o vídeo.

### 5.6 Filtros (`aplicar_filtro`)
- `Nenhum`, `Suave` (lum/contraste/gamma) ou `Preto e Branco`.

### 5.7 Narração neural (`narration.py` + mixagem)
- **Piper** (TTS local, `C:\Piper\...`, modelo `pt_BR-faber-medium`) para voz `padrao`.
- **XTTS** (serviço na porta 8095, estilo `viral_tiktok`) para vozes personalizadas.
- **Narração do título:** o WAV é mixado sobre o áudio original com **delay + ducking** (`_mix_narracao_titulo`): o original "abaixa" (volume `NARRATION_DUCK_VOLUME=0.03`) durante a fala e volta suavemente (rampa `NARRATION_FADE_S=0.3s`).
- **Narrações personalizadas:** múltiplos textos em timestamps definidos; cada um gera um WAV, é atrasado para `start_sec`, e pode inserir um **freeze frame** no ponto (`_inserir_freeze_frame_com_narracao`).
- Áudios de preset (`backend/assets/preset_audios/mapa_audios.json`) são reutilizados quando o texto coincide.

### 5.8 Legenda automática TikTok (`subtitles.py`)
- `extrair_audio()` → WAV 16k mono.
- `transcrever()` → **faster-whisper** (GPU `cuda`/small por padrão, fallback CPU/int8) com `word_timestamps` e VAD, idioma `pt`.
- Gera arquivo **ASS** com a palavra falada destacada, queimado no vídeo via `libass` (NVENC quando disponível).
- **Estilos:** `AMARELO_CLASSICO` (frase + palavra amarela), `POP_BRANCO` (só a palavra, escala animada), `BOX_HORMOZI` (caixa branca, 3 palavras), `NEON_VERDE` (glow verde).

### 5.9 Hook / Intro viral (`_adicionar_hook` / `_adicionar_intro_viral`)
- Prependa um gancho de ~3s antes do vídeo para prender a atenção:
  - extrai 1 frame do cru → aplica **blur** como fundo;
  - overlay + título animado palavra a palavra (ASS) + narração (TTS);
  - **efeitos sonoros** de entrada (notificação/whoosh/camera/click) e saída (whoosh) de `sfx/`;
  - concatena intro + vídeo principal em passos separados (evita estouro de memória do ffmpeg).
- Tipos: `textao` (full HD + letras grandes) e `corte_seco` (zoom + impacto).

### 5.10 Trilha sonora viral
- Músicas de `music/` podem substituir ou mixar com o áudio original (`musica_modo`: `100_musica` ou `50_50`). Baixadas via `download_musicas.py` (yt-dlp + ffmpeg).

### 5.11 Tarja
- Caixa preta (`config.TARJA_DEFAULT`, fração 0..1) arrastável no preview para cobrir marca d'água, com texto opcional.

### 5.12 Exportação e GPU
- Detecção de **NVENC** (`_detectar_nvenc`): se disponível usa `h264_nvenc` (GPU), senão `libx264` (CPU).
- O MoviePy emite progresso da exportação via `proglog` (`_EmitLogger`) → evento `progress` (fase `exportando`).

### 5.13 Upload para o Drive (`drive_uploader.py`)
- OAuth (browser na 1ª vez, `token.json` cacheado em `C:\Users\78787\.gdrive\`).
- Garante a pasta `clips-prontos` (ou a **pasta selecionada** em `FolderPanel`) e faz upload resumable (8 MB/chunk).
- Retorna `web_view_link`; o item na fila mostra ☁️ e link.
- Após upload OK, **limpa disco**: apaga o clip final e o vídeo cru (`_cleanup_local`), liberando espaço.

### 5.14 Progresso em tempo real (WebSocket)
- `WSManager.broadcast` envia eventos: `batch_started`, `started`, `status`, `progress`, `done`, `error`, `uploading`, `uploaded`, `cleaned`, `upload_error`, `all_done`.
- O frontend (`ws.ts`) atualiza fila, barras, cronômetro e ETA a partir desses eventos.

---

## 6. Parâmetros centrais (`config.py`)

| Parâmetro | Valor | Função |
|-----------|-------|--------|
| `WIDTH` / `HEIGHT` | 1080 / 1920 | Resolução de saída (9:16) |
| `VIDEO_SCALE_RATIO_VERTICAL` | 0.937 | Escala do vídeo dentro do moldura |
| `TITLE_FONT_SIZE` | 56 | Tamanho do título (px) |
| `TITLE_Y_MIN/MAX/DEFAULT` | 50 / 700 / 330 | Altura do título |
| `VIDEO_Y_MIN/MAX/DEFAULT` | -800 / 800 / 0 | Deslocamento vertical do vídeo |
| `FONTS` | Padrão / Manuscrita / Estilo 1 / Estilo 2 | Fontes do título |
| `CORES_TITULO` | Branco, Amarelo, Preto, Vermelho, Verde, Azul, Rosa | Cores do título |
| `FILTROS` | Nenhum / Suave / Preto e Branco | Filtros visuais |
| `NARRATION_DELAY_S` / `DUCK_VOLUME` / `FADE_S` | 0.0 / 0.03 / 0.3 | Mixagem da narração |
| `WHISPER_MODEL_SIZE` / `DEVICE` | small / cuda | Transcrição de legenda |
| `LEGENDA_Y_FRAC` | 0.78 | Posição vertical da legenda |
| `ESTILOS_LEGENDA` | AMARELO_CLASSICO, POP_BRANCO, BOX_HORMOZI, NEON_VERDE | Estilos de legenda |
| `HOOK_TIPOS` / `HOOK_DURATION_S` | textao/corte_seco / 3.0 | Hook de retenção |
| `HOOK_SOM_OPCOES` | whoosh, camera, click, notificacao, none | SFX do hook |

---

## 7. API (principais rotas)

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/gpu` | Status da GPU (NVENC) |
| GET/POST | `/api/videos` | Lista / adiciona vídeo |
| DELETE/PATCH | `/api/videos/{idx}` | Remove / edita vídeo |
| POST | `/api/videos/{idx}/queue` · DELETE `…/queue` | Enfileira / desenfileira |
| POST | `/api/search` | Busca Shorts virais por tema |
| POST | `/api/process` | Coloca todos `editando` na fila |
| POST | `/api/processing/reset` | Reinicia worker travado |
| POST | `/api/videos/{idx}/retry-upload` | Reenvia clip p/ Drive |
| DELETE | `/api/videos/{idx}/local` | Apaga arquivo local (libera disco) |
| GET | `/api/clips` · `/api/clips/{filename}` | Lista / serve clips prontos |
| GET/POST/DELETE | `/api/overlays` · `/api/overlay/{key}` | Gerencia overlays PNG |
| GET | `/api/titles/random` · `/api/hooks/random` | Título/gancho aleatórios |
| GET | `/api/frame?url=` | Frame de preview (cacheado) |
| GET | `/api/pastas` · POST/PUT/DELETE | Pastas de destino no Drive |
| GET | `/api/drive/status` | Estado das credenciais do Drive |
| GET | `/api/narration-voices` · `/api/music` · `/api/sfx` | Catálogos para a UI |
| WS | `/ws/progress` | Eventos de progresso em tempo real |
| (voz) | `/voz/health`, `/voz/voices`, `/voz/styles`, `/voz/generate` | Serviço XTTS externo |

---

## 8. Pontos de atenção

- **Estado em memória:** `lista_videos` vive no processo do backend. Reiniciar o servidor zera a fila (os clips já no Drive permanecem).
- **Cookies:** `cookies.txt` é opcional mas recomendado para downloads estáveis do YouTube.
- **Pastas do Drive:** gerenciadas em `pastas.py`; a selecionada recebe os uploads. O fallback é `clips-prontos`.
- **Tempo limite:** cada vídeo tem timeout de 1500s no worker; acima disso vira `erro`.
- **Hook/Intro viral:** exigem Piper disponível e título não vazio; caso contrário são pulados silenciosamente.
- **Whisper:** primeiro vídeo do lote demora mais (carrega o modelo); os seguintes reutilizam (singleton cacheado).
