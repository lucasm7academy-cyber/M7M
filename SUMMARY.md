## Meta
Construir um sistema de hook automático (3 tipos configuráveis) para vídeos curtos estilo viral, rodando independentemente das outras features.

## Restrições & Preferências
- Windows, projeto em `C:\Users\78787\Documents\moviepy`
- Backend FastAPI (Python) + Frontend Vite/React/TypeScript
- NVENC GPU (RTX 3060 Ti) ativo para codificação
- Upload pro Google Drive após processamento
- Overlay PNG mascara o viewport do vídeo; scale do vídeo deve casar com a abertura do overlay precisamente
- Narração (Piper TTS), legenda, freeze-frame ainda usados
- Suporte Instagram requer `cookies.txt` na raiz do projeto
- Repositório em `https://github.com/lucasm7academy-cyber/M7M.git`

## Progresso
### Pronto
- Substituído MoviePy `write_videofile` duplo (RAW + FINAL) por composição ffmpeg em UM PASSO (scale + overlay + título + áudio + tarja)
- Título e tarja renderizados como PNG estático via MoviePy `TextClip.save_frame`
- Worker de fila em background – loop contínuo processando vídeos `"na_fila"` um por um
- `criar_emit_para()` wrapper injeta `id` em todo evento WebSocket, resolve `idx` dinamicamente
- `/api/videos/{idx}/queue` (POST) e (DELETE) para queue/dequeue individual
- `/api/process` enfileira todos `"editando"` – sem 409, sem batch lock
- Frontend: emoji de status (📝), botões queue/dequeue, WebSocket casado por `e.id`
- `VIDEO_SCALE_RATIO_VERTICAL = 0.937` (1012 px largura, +5 px cada lado)
- Corrigido bug do pad filter: substituído ffmpeg `pad` por abordagem `color+overlay` (build N-122346 ignora `y` no `pad` depois de `scale` com `if()`)
- Suporte Instagram: `_extrair_video_id` e `_video_id_from_url` extraem IDs de reels/posts; `cookies.txt` para auth
- Criado `sfx/whoosh.mp3` para efeitos sonoros de hook
- **Hook `_adicionar_hook()` totalmente implementado** em `video_processor.py` (blur/textao/corte_seco com extração de frame, overlay, drawtext, whoosh opcional, concat pra prepend)
- **Bug do `a_idx` corrigido**: usava `len(inputs)-1` (contava TODOS args CLI) → agora usa contador `n_inputs` correto
- **Ordem Hook–Viral corrigida**: intro viral roda PRIMEIRO, hook roda SEGUNDO pra hook ficar na posição 0 (ambos fazem prepend via concat)
- **Rastreamento de offset corrigido**: `offset_corrente` agora usa `dur_total_prepend` (soma das durações hook + viral)
- **Posicionamento de vídeo revertido** para `overlay=(W-w)/2:{pad_y}` original com scale baseado em expressão — removido `detectar_abertura_overlay` (você não quis), removido helper `_get_dimensions`
- **Preview `framePlacement` reescrito**: usa `left: 50%; transform: translate(-50%, -50%)` ao invés de `left: (W-dispW)/2` percentual pra evitar erros de arredondamento
- **Removido `transition-opacity duration-200`** da imagem do frame no preview (elimina o "pisca" onde o frame aparecia na posição errada durante o fade)
- **Criado `RESTART_APP.bat`**: mata 3 servidores por título da janela + porta e reinicia
- **Modificado `INICIAR_APP.bat`**: removido `timeout /t 15` e `start "" "http://localhost:5174/"` (abertura automática do navegador)
- UI do hook adicionada no `ConfigPanel.tsx` (toggle ON/OFF, seletor de tipo, texto customizado, seletor de som)
- Campos de hook adicionados ao `UpdateVideoRequest` no backend, defaults do item, e handler PATCH
- Endpoints `/api/sfx` e `/api/music` adicionados
- Projeto enviado pro GitHub

### Em Andamento
- **(nenhum — sistema de hook completo)**

### Bloqueado
- Cadeia de filtro drawtext no hook pode ter problema de avaliação de expressão do ffmpeg (`x=(w-text_w)/2`) — mesma build N-122346 que tem o bug do pad filter
- Você reportou que hook ainda não aparece no vídeo processado — precisa reiniciar + retestar com as correções recentes

## Decisões Importantes
- **ffmpeg sobre MoviePy pra codificação**: um único pass ffmpeg ~10 s vs ~3 min com MoviePy
- **color+overlay ao invés de pad**: bug do ffmpeg `pad` nesta build (N-122346-g840183d823-20260104)
- **Hook roda POR ÚLTIMO**: ambos hook e intro viral fazem prepend via concat; último prepend vence posição 0
- **Centralização do preview via CSS transform**: `left: 50%; translate(-50%)` evita erros de arredondamento de `(W-w)/2`
- **Sem auto-detecção de abertura de overlay**: você rejeitou `detectar_abertura_overlay` — quer posicionamento fixo
- **Sem abertura automática de navegador**: removido do `INICIAR_APP.bat`
- **Cookies Instagram**: `cookies.txt` na raiz do projeto para auth

## Próximos Passos
1. Reiniciar servidores com `RESTART_APP.bat` e reprocessar um vídeo com hook ON pra verificar a correção do `a_idx` e da ordenação
2. Se hook ainda falhar, verificar stderr do ffmpeg na cadeia drawtext — possível bug de avaliação de expressão nesta build
3. Adicionar música de fundo (trilha sonora) – `/api/music` já existe, precisa de mix/ducking no pipeline + seletor no frontend
4. Adicionar estilo de legenda palavra-por-palavra (estilo TikTok) depois que hook e música estiverem estáveis
5. Considerar timer auto-processo tipo `cron` (`/api/queue/auto?delay_hours=X`)

## Contexto Crítico
- **NVENC ativo** – `h264_nvenc` com `-preset p4`
- **Piper TTS disponível** – `pt_BR-faber-medium.onnx`
- **ffmpeg build N-122346-g840183d823-20260104** – bug do y no pad CONFIRMADO; drawtext pode também ter bug
- **Cookies file**: `C:\Users\78787\Documents\moviepy\cookies.txt`
- **SFX**: `C:\Users\78787\Documents\moviepy\sfx\whoosh.mp3`
- **Overlays**: `overlay1.png` existe (299380 bytes), `overlay4.png` existe (64323 bytes), `overlay2.png` removido
- **Parâmetros do hook**: 3s duração, tipos blur/textao/corte_seco, whoosh opcional (2300ms delay, toca 0.7s antes do vídeo principal)
- **`RESTART_APP.bat`** mata por título da janela + porta e reinicia os 3 servidores
- **Causa do pisca no preview**: `useEffect(() => setAspect(null), [video?.url])` reseta aspect na mudança de URL; `transition-opacity` causava artefato visual de 200ms; ambos mitigados com centralização via transform + sem transition

## Arquivos Relevantes
- `backend/video_processor.py` – `_adicionar_hook()` (completo), `_adicionar_intro_viral()`, `processar_video()` fluxo principal com ordenação hook+viral
- `backend/config.py` – `HOOK_TIPOS`, `HOOK_DURATION_S`, `HOOK_TEXT_DEFAULT`, `HOOK_SOM_OPCOES`, `SFX_DIR`, `MUSIC_DIR`
- `backend/main.py` – `UpdateVideoRequest` model, handler PATCH, campos de hook nos defaults do item, endpoints `/api/music`, `/api/sfx`, `/api/overlays`
- `frontend/src/api.ts` – Tipo `VideoItem` com campos de hook, `OverlayInfo`
- `frontend/src/components/ConfigPanel.tsx` – Seção UI do hook (tipo, texto, som)
- `frontend/src/components/PreviewPanel.tsx` – `framePlacement()` usando `left:50%;transform:translate(-50%,-50%)`, sem `transition-opacity`
- `INICIAR_APP.bat` – Inicia 3 servidores (sem abrir navegador)
- `RESTART_APP.bat` – Mata + reinicia 3 servidores
- `sfx/whoosh.mp3` – Efeito sonoro do hook
- `cookies.txt` – Cookies de autenticação do Instagram
