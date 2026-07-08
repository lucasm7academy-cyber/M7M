# =========================
# CONFIGURAÇÕES FIXAS
# =========================
import os

WIDTH  = 1080
HEIGHT = 1920
MASK_HEIGHT = 1260
MASK_CENTER_Y = 1115
# 0.90 = reduz a escala para que vídeos horizontais e verticais
# fiquem menores e suas laterais não sejam cortadas pelo overlay.
VIDEO_SCALE_RATIO_VERTICAL = 0.937

TITLE_FONT_SIZE  = 56   # px sobre 1080 largura ≈ 5.2% (espelhado no preview)
TITLE_WIDTH_RATIO = 0.85
TITLE_Y_OFFSET   = 330

# Altura do título (slider no front). Maior = mais baixo na imagem.
TITLE_Y_MIN     = 50
TITLE_Y_MAX     = 700
TITLE_Y_DEFAULT = TITLE_Y_OFFSET

# Posição vertical do vídeo (slider no front). Positivo = desce (mostra topo),
# negativo = sobe (mostra base). Espelhado no preview.
VIDEO_Y_MIN     = -800
VIDEO_Y_MAX     = 800
VIDEO_Y_DEFAULT = 0

# ── Paths automáticos ─────────────────────────────────────────────────────────
# Dentro do Docker  → /app/
# Fora do Docker (Windows direto) → pasta raiz do projeto (um nível acima de backend/)

def _root() -> str:
    """Retorna a pasta raiz do projeto independente de onde está rodando."""
    # Sobe um nível a partir de backend/ — funciona sempre
    candidate = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    # Dentro do Docker o projeto está em /app/ — verifica pelo overlay
    docker_root = "/app"
    if os.path.exists(os.path.join(docker_root, "overlay1.png")):
        return docker_root
    return candidate

ROOT = _root()

FONT_PATH    = os.path.join(ROOT, "DejaVuSans-Bold.ttf")
OUTPUT_DIR   = os.path.join(ROOT, "clips")
DOWNLOAD_DIR = os.path.join(ROOT, "downloads")
FRAMES_DIR   = os.path.join(ROOT, "frames")   # cache de frames pro preview
COOKIES_FILE = os.path.join(ROOT, "cookies.txt")
SFX_DIR = os.path.join(ROOT, "sfx")
MUSIC_DIR = os.path.join(ROOT, "music")

# Tarja (caixa preta + texto) — cobre marca d'água. Valores em fração 0..1.
TARJA_DEFAULT = {
    "ativo": False,
    "x": 0.35, "y": 0.45,   # canto superior-esquerdo da caixa (fração)
    "w": 0.30, "h": 0.07,   # largura/altura (fração)
    "texto": "@m7academy_",  # texto centralizado (opcional)
}

# Fontes disponíveis para o título (label → arquivo na raiz do projeto).
# A primeira é o padrão.
FONTS = {
    "Padrão":     "DejaVuSans-Bold.ttf",
    "Manuscrita": "Caveat-Bold.ttf",
    "Estilo 1":   "Anton-Regular.ttf",       # impacto, condensada pesada
    "Estilo 2":   "BebasNeue-Regular.ttf",   # alta condensada (caixa alta)
}
FONT_DEFAULT = "Padrão"

def font_path(label: str) -> str:
    """Caminho absoluto da fonte pelo label; cai no padrão se não existir."""
    nome = FONTS.get(label, FONTS[FONT_DEFAULT])
    caminho = os.path.join(ROOT, nome)
    return caminho if os.path.exists(caminho) else FONT_PATH

# Filtros de vídeo (aplicados no vídeo, abaixo da máscara/overlay).
FILTROS = ["Nenhum", "Suave", "Preto e Branco"]
FILTRO_DEFAULT = "Nenhum"

# Cores do título (label → hex). A primeira é o padrão.
CORES_TITULO = {
    "Branco":   "#FFFFFF",
    "Amarelo":  "#FFD400",
    "Preto":    "#000000",
    "Vermelho": "#FF3B30",
    "Verde":    "#27E36B",
    "Azul":     "#3B82F6",
    "Rosa":     "#FF2D95",
}
COR_TITULO_DEFAULT = "Branco"

def cor_titulo_hex(label: str) -> str:
    return CORES_TITULO.get(label, CORES_TITULO[COR_TITULO_DEFAULT])

# Deslocamento Y do vídeo dentro do quadrado central do overlay.
# A base é (HEIGHT - clip.h) // 2 ≈ 58px (vídeo já centralizado).
# Folga total = 1920 - 1804 ≈ 116px → 58px pra cada lado.
#
# Convenção visual (intuitiva pro usuário):
#   CIMA  → desce o vídeo (revela MAIS do TOPO do conteúdo) → offset positivo
#   MEIO  → centralizado dentro do quadrado do overlay      → offset 0
#   BAIXO → sobe o vídeo  (revela MAIS da BASE do conteúdo) → offset negativo
#
# Valores limitados a ±50px (cabem na folga de 58px sem cortar o vídeo).
Y_PRESETS = {
    "CIMA":   200,   # desloca +200px — mostra topo do conteúdo
    "MEIO":     0,   # centralizado
    "BAIXO": -200,   # desloca -200px — mostra base do conteúdo
}

import re as _re

def overlay_path(key: str) -> str:
    """Caminho absoluto do overlayN.png na raiz do projeto (existindo ou não)."""
    return os.path.join(ROOT, f"overlay{key}.png")


def _list_overlay_keys() -> list[str]:
    """Lista (ordenada numericamente) das chaves de overlays disponíveis no disco."""
    keys: list[str] = []
    if not os.path.isdir(ROOT):
        return keys
    pat = _re.compile(r"^overlay(\d+)\.png$", _re.IGNORECASE)
    for name in os.listdir(ROOT):
        full = os.path.join(ROOT, name)
        if not os.path.isfile(full):
            continue
        m = pat.match(name)
        if m:
            keys.append(m.group(1))
    keys.sort(key=lambda k: int(k))
    return keys


class _OverlaysProxy:
    """Compatível com o uso atual: OVERLAYS.get(key), OVERLAYS.items(), iter(OVERLAYS).

    Resolve a lista de overlays em runtime, escaneando overlay*.png na raiz.
    Assim, adicionar/remover arquivos reflete imediatamente sem reiniciar o app.
    """

    def get(self, key, default=None):
        if key is None:
            return default
        path = overlay_path(str(key))
        return path if os.path.exists(path) else default

    def __getitem__(self, key):
        v = self.get(key)
        if v is None:
            raise KeyError(key)
        return v

    def __contains__(self, key):
        return self.get(key) is not None

    def keys(self):
        return _list_overlay_keys()

    def items(self):
        return [(k, overlay_path(k)) for k in _list_overlay_keys()]

    def values(self):
        return [overlay_path(k) for k in _list_overlay_keys()]

    def __iter__(self):
        return iter(_list_overlay_keys())

    def __len__(self):
        return len(_list_overlay_keys())


OVERLAYS = _OverlaysProxy()

# ── TTS (Piper) ───────────────────────────────────────────────────────────────
# Voz neural local. Override via env var se quiser outro caminho/modelo.
PIPER_EXE   = os.environ.get("PIPER_EXE",   r"C:\Piper\piper\piper.exe")
PIPER_MODEL = os.environ.get("PIPER_MODEL", r"C:\Piper\piper\models\pt_BR-faber-medium.onnx")

# Delay antes da voz começar (segundos) e volume do áudio original durante a fala
NARRATION_DELAY_S          = 0.0
NARRATION_DUCK_VOLUME      = 0.03
# Duração da rampa suave (fade in/out) ao entrar/sair do ducking — em segundos.
# 0 = corte seco; 0.3 = transição perceptível e natural.
NARRATION_FADE_S           = 0.3

# ── Legendas automáticas (faster-whisper + libass) ───────────────────────────
# Whisper roda na GPU pra transcrever o áudio com timestamps por palavra.
WHISPER_MODEL_SIZE   = os.environ.get("WHISPER_MODEL_SIZE", "small")
WHISPER_DEVICE       = os.environ.get("WHISPER_DEVICE",     "cuda")     # "cpu" fallback
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE",    "float16")  # "int8" em CPU

# Posição vertical da legenda dentro do frame 9:16 (0=topo, 1=base).
# 0.70 = ~70% da altura → meio-baixo, padrão TikTok, não sobrepõe o conteúdo.
LEGENDA_Y_FRAC    = 0.78
LEGENDA_FONT_SIZE = 64                  # pt; ASS escala em função do PlayResY
LEGENDA_FONT      = "DejaVu Sans"       # disponível via libass system fonts no Windows

# Máximo de palavras por legenda — mantém em 1 linha (evita quebrar/2 linhas).
LEGENDA_MAX_PALAVRAS = 3
# Margem lateral (px de cada lado). Maior = legenda mais estreita, longe das bordas.
# WIDTH=1080 → 180px de cada lado deixa ~720px úteis (~67% da largura).
LEGENDA_MARGIN_H  = 180

# Estilos suportados pelo subtitles.py. Ordem importa: o primeiro é o default.
ESTILOS_LEGENDA = ["AMARELO_CLASSICO", "POP_BRANCO", "BOX_HORMOZI", "NEON_VERDE"]

TITULOS_PADRAO = [
    "Que play foi essa?!",
    "Isso aqui foi insano demais...",
    "Pouca gente faria essa jogada...",
    "Essa play foi absurda...",
    "Olha essa mecânica...",
    "Isso aqui não é pra qualquer um...",
    "Esse momento virou o jogo...",
    "Essa decisão foi perfeita...",
    "Mecânica limpa demais...",
    "Isso é League of Legends de verdade...",
    "Quando a leitura de jogo é perfeita...",
    "Essa jogada foi milimétrica...",
    "Quem entende do jogo, faz assim...",
    "Esse micro foi absurdo...",
    "Esse macro decidiu tudo...",
    "Olha o impacto dessa play...",
    "Execução perfeita no momento certo...",
    "Essa play valeu a partida...",
    "Isso é gameplay de alto nível...",
    "Simplesmente insano...",
]

HOOK_TIPOS = ["textao", "corte_seco"]
HOOK_TIPO_DEFAULT = "textao"
HOOK_DURATION_S = 3.0
HOOK_TEXT_DEFAULT = "OLHA ISSO!"
HOOK_SOM_OPCOES = ["whoosh", "camera", "click", "notificacao", "none"]
HOOK_SOM_ENTRADA_DEFAULT = "notificacao"
HOOK_SOM_SAIDA_DEFAULT = "whoosh"
HOOK_FADE_DUR_S = 0.15

