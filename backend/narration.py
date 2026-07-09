"""
backend/narration.py — Narração neural de título via Piper TTS + XTTS (voz_ai).

Mantém uma superfície mínima e pura: gera um WAV temporário a partir de um
texto, e expõe utilidades para sondar duração de áudio e disponibilidade
do binário Piper. A mixagem com o áudio do vídeo é feita em video_processor.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import urllib.request
import urllib.error

from config import PIPER_EXE, PIPER_MODEL


# Flag análoga a GPU_AVAILABLE em video_processor: o pipeline degrada
# graciosamente quando Piper não está instalado nessa máquina.
PIPER_AVAILABLE = os.path.exists(PIPER_EXE) and os.path.exists(PIPER_MODEL)

if PIPER_AVAILABLE:
    print(f"[TTS] Piper disponível — modelo: {os.path.basename(PIPER_MODEL)}")
else:
    print(f"[TTS] Piper indisponível (procurando em {PIPER_EXE}). Narração será ignorada.")

XTTS_BASE_URL = "http://localhost:8095"
"""URL base do servidor voz_ai (XTTS v2)."""


def xtts_disponivel() -> bool:
    """Verifica se o servidor XTTS está online e com modelo carregado."""
    try:
        req = urllib.request.Request(f"{XTTS_BASE_URL}/voz/health", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return bool(data.get("loaded", False))
    except Exception:
        return False


def gerar_wav_xtts(texto: str, voice_id: str = "luis_moray") -> str | None:
    """Gera WAV via voz_ai (XTTS) com estilo viral_tiktok.

    Configuração fixa para narração de vídeo:
      - Estilo: viral_tiktok (rápido, direto, animado)
      - Calor (warmth): 0% (seco, sem reverb)
      - Eco de estúdio: desligado
      - Tags Fish-style: desligadas
      - Polimento: ligado (EQ + compressor)
      - Respiração entre parágrafos: ligado

    Retorna caminho do WAV temporário ou None em caso de erro.
    """
    if not texto or not texto.strip():
        return None

    payload = {
        "text": texto.strip(),
        "voice": voice_id,
        "style": "viral_tiktok",
        "warmth": 0.0,
        "tags": False,
        "studio_echo": False,
        "polish": True,
        "breath": True,
    }

    try:
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{XTTS_BASE_URL}/voz/generate",
            data=data_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            wav_data = resp.read()

        if not wav_data:
            print(f"[XTTS] resposta vazia para voice='{voice_id}'")
            return None

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False, prefix="tts_xtts_") as tmp:
            tmp.write(wav_data)
            return tmp.name
    except urllib.error.HTTPError as e:
        print(f"[XTTS] HTTP {e.code} para voice='{voice_id}': {e.read().decode(errors='replace')[:200]}")
        return None
    except Exception as e:
        print(f"[XTTS] erro voice='{voice_id}': {e}")
        return None


def _aplicar_suavidade(texto: str, nivel: int = 2) -> str:
    """
    Insere quebras de linha para criar pausas naturais.
    Idêntico à lógica usada em narracao.py / audio.py.
        0 = seco
        1 = pausas curtas
        2 = natural (default)
        3 = dramático
    """
    if nivel == 0:
        return texto
    frases = [linha.strip() for linha in texto.split("\n") if linha.strip()]
    if nivel == 1:
        return "\n".join(frases)
    if nivel == 2:
        return "\n\n".join(frases)
    if nivel == 3:
        return "\n\n\n".join(frases)
    return texto


def gerar_wav_titulo(texto: str) -> str | None:
    """
    Gera um WAV temporário com a narração do título.
    Retorna o caminho do arquivo, ou None em caso de erro / texto vazio /
    Piper indisponível. Caller é responsável por apagar o arquivo.
    """
    if not PIPER_AVAILABLE:
        return None
    if not texto or not texto.strip():
        return None

    texto_processado = _aplicar_suavidade(texto, nivel=2)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False, prefix="tts_titulo_") as tmp:
        wav_path = tmp.name

    comando = [
        PIPER_EXE,
        "--stdin",
        "--model", PIPER_MODEL,
        # Configuração Otimizada para Retenção/Viral (TikTok style):
        # length_scale: Velocidade. Menor = mais rápido. 0.85 acelera em ~15% (ideal para reter atenção).
        "--length_scale", "0.85",
        # noise_scale: Expressividade. 0.667 é o default; mantido para soar humano, mas focado.
        "--noise_scale",  "0.667",
        # noise_w: Variação de ritmo. Reduzido de 0.8 para 0.7 para uma cadência mais firme e direta.
        "--noise_w",      "0.7",
        "--output_file",  wav_path,
    ]

    try:
        proc = subprocess.Popen(
            comando,
            stdin=subprocess.PIPE,
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        proc.communicate(texto_processado)
        if proc.returncode != 0 or not os.path.exists(wav_path) or os.path.getsize(wav_path) == 0:
            if os.path.exists(wav_path):
                try: os.unlink(wav_path)
                except OSError: pass
            print("[TTS] Piper retornou código != 0 ou WAV vazio")
            return None
        return wav_path
    except Exception as e:
        print(f"[TTS] Erro gerando WAV: {e}")
        if os.path.exists(wav_path):
            try: os.unlink(wav_path)
            except OSError: pass
        return None


def get_audio_duration(audio_path: str) -> float:
    """Duração de um arquivo de áudio em segundos via ffprobe. 0 em caso de erro."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "quiet",
             "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1",
             audio_path],
            capture_output=True, text=True, check=True,
        )
        return float(r.stdout.strip())
    except Exception as e:
        print(f"[TTS] ffprobe falhou em {audio_path}: {e}")
        return 0.0


def gerar_wav(texto: str, voice_id: str = "padrao") -> str | None:
    """Gera WAV de narração. Roteia entre Piper e XTTS conforme voice_id.

    - voice_id == 'padrao' (ou vazio): usa Piper (TTS local)
    - voice_id == id de voz XTTS:   usa voz_ai (porta 8095)
    """
    import json
    import tempfile
    
    mapa_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "preset_audios", "mapa_audios.json")
    if os.path.exists(mapa_path):
        try:
            with open(mapa_path, "r", encoding="utf-8") as f:
                mapa = json.load(f)
            if texto in mapa:
                preset_mp3 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", mapa[texto])
                if os.path.exists(preset_mp3):
                    print(f"[TTS] Usando audio preset para: {texto}")
                    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".wav", prefix="tts_preset_")
                    os.close(tmp_fd)
                    subprocess.run([
                        "ffmpeg", "-y", "-loglevel", "error",
                        "-i", preset_mp3, "-filter:a", "volume=2dB",
                        "-c:a", "pcm_s16le", tmp_path
                    ], capture_output=True)
                    return tmp_path
        except Exception as e:
            print(f"[TTS] Erro ao ler preset: {e}")

    if not voice_id or voice_id == "padrao":
        wav = gerar_wav_titulo(texto)
    else:
        wav = gerar_wav_xtts(texto, voice_id)

    if not wav or not os.path.exists(wav):
        return None

    # Aumentar +2dB no áudio da narração (reforço de volume solicitado)
    boosted_wav = wav + ".boost.wav"
    try:
        r = subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", wav, "-filter:a", "volume=2dB",
            "-c:a", "pcm_s16le", boosted_wav
        ], capture_output=True)
        if r.returncode == 0 and os.path.exists(boosted_wav):
            try: os.unlink(wav)
            except OSError: pass
            os.replace(boosted_wav, wav)
    except Exception as e:
        print(f"[TTS] erro ao aplicar +2dB: {e}")
        if os.path.exists(boosted_wav):
            try: os.unlink(boosted_wav)
            except OSError: pass

    return wav
