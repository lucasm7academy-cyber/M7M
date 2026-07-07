"""
Legendas automáticas estilo TikTok para os Shorts processados.

Pipeline:
  1. extrair_audio(video)  → WAV 16k mono em %TEMP%
  2. transcrever(wav)      → list[{start, end, word}] (word-level)
  3. gerar_ass(words,...)  → arquivo .ass com timing e estilo escolhidos
  4. queimar_legenda(...)  → ffmpeg burn (NVENC quando disponível)

Estilos:
  AMARELO_CLASSICO  frase inteira + palavra atual em amarelo
  POP_BRANCO        só a palavra falada, com escala animada
  BOX_HORMOZI       caixa branca com 3 palavras por vez
  NEON_VERDE        frase + palavra atual com glow verde
"""
from __future__ import annotations

import os
import sys
import tempfile
import threading
import subprocess
from pathlib import Path
from typing import Optional

from config import (
    WIDTH, HEIGHT,
    WHISPER_MODEL_SIZE, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE,
    LEGENDA_Y_FRAC, LEGENDA_FONT_SIZE, LEGENDA_FONT, ESTILOS_LEGENDA,
    LEGENDA_MAX_PALAVRAS, LEGENDA_MARGIN_H,
)


def _safe_print(*args):
    text = " ".join(str(a) for a in args)
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        enc = sys.stdout.encoding or "utf-8"
        print(text.encode(enc, errors="replace").decode(enc, errors="replace"),
              flush=True)


# ── Whisper singleton (lazy) ──────────────────────────────────────────────────

_whisper_model = None
_whisper_lock  = threading.Lock()


def _whisper():
    """Carrega o modelo Whisper sob demanda e cacheia entre vídeos do batch.

    Estratégia: tenta CUDA primeiro; cai pra CPU se faltar cuBLAS/cuDNN.
    O fallback precisa ser robusto pq o `WhisperModel.__init__` em CUDA
    NÃO levanta erro — a falha só aparece em `transcribe()`. Por isso
    fazemos um probe rápido após carregar.
    """
    global _whisper_model
    with _whisper_lock:
        if _whisper_model is not None:
            return _whisper_model
        from faster_whisper import WhisperModel

        def _try_load(device: str, compute: str):
            _safe_print(f"[whisper] carregando {WHISPER_MODEL_SIZE} ({device}, {compute})...")
            return WhisperModel(WHISPER_MODEL_SIZE, device=device, compute_type=compute)

        # 1) CUDA configurado pelo user
        if WHISPER_DEVICE != "cpu":
            try:
                m = _try_load(WHISPER_DEVICE, WHISPER_COMPUTE_TYPE)
                # Probe rápido pra detectar cuBLAS/cuDNN ausente
                try:
                    import tempfile, wave, struct
                    fd, probe = tempfile.mkstemp(suffix=".wav"); os.close(fd)
                    with wave.open(probe, "wb") as wf:
                        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(16000)
                        wf.writeframes(b"\x00\x00" * 16000)  # 1s silêncio
                    segs, _ = m.transcribe(probe, beam_size=1)
                    list(segs)   # força execução
                    try: os.unlink(probe)
                    except OSError: pass
                    _whisper_model = m
                    _safe_print(f"[whisper] modelo pronto ({WHISPER_DEVICE})")
                    return _whisper_model
                except Exception as probe_err:
                    try: os.unlink(probe)
                    except (OSError, NameError): pass
                    _safe_print(f"[whisper] CUDA probe falhou: {probe_err}")
                    raise
            except Exception as e:
                _safe_print(f"[whisper] CUDA indisponível ({e}) — caindo pra CPU/int8")

        # 2) Fallback CPU/int8
        _whisper_model = _try_load("cpu", "int8")
        _safe_print("[whisper] modelo pronto (cpu/int8)")
        return _whisper_model


# ── Extração + transcrição ────────────────────────────────────────────────────

def extrair_audio(video_path: str) -> Optional[str]:
    """ffmpeg extrai mono 16 kHz WAV em %TEMP%. Devolve path ou None."""
    fd, wav = tempfile.mkstemp(suffix=".wav", prefix="subs_")
    os.close(fd)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", video_path,
        "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le",
        wav,
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=120)
        if r.returncode != 0 or not os.path.exists(wav) or os.path.getsize(wav) < 1000:
            _safe_print(f"[subs] extrair_audio falhou: {r.stderr.decode('utf-8','replace')[-200:]}")
            try: os.unlink(wav)
            except OSError: pass
            return None
        return wav
    except Exception as e:
        _safe_print(f"[subs] extrair_audio erro: {e}")
        try: os.unlink(wav)
        except OSError: pass
        return None


def transcrever(audio_path: str) -> list[dict]:
    """Devolve [{start, end, word}] word-level. Lista vazia se nada falado."""
    model = _whisper()
    palavras: list[dict] = []
    try:
        segments, info = model.transcribe(
            audio_path,
            language="pt",
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
        )
        for seg in segments:
            for w in (seg.words or []):
                token = (w.word or "").strip()
                if not token:
                    continue
                palavras.append({
                    "start": float(w.start),
                    "end":   float(w.end),
                    "word":  token,
                })
        _safe_print(f"[whisper] {len(palavras)} palavras transcritas")
    except Exception as e:
        _safe_print(f"[whisper] transcrição falhou: {e}")
    return palavras


# ── Geração do ASS ────────────────────────────────────────────────────────────

def _fmt_ts(t: float) -> str:
    """Formato ASS: H:MM:SS.cs (centissegundos)."""
    if t < 0:
        t = 0.0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int(round((t - int(t)) * 100))
    if cs == 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")


def _ass_header(estilo: str) -> str:
    """
    Cabeçalho ASS com Style customizada por estilo escolhido.
    Cores ASS: &HAABBGGRR (alpha, blue, green, red — ordem invertida!).
    """
    margin_v = int(HEIGHT * (1.0 - LEGENDA_Y_FRAC))   # ASS conta de baixo→cima

    # Configuração comum (overrides por estilo abaixo)
    primary   = "&H00FFFFFF"   # branco
    secondary = "&H00FFFFFF"
    outline   = "&H00000000"   # preto
    back      = "&H00000000"
    border_style = 1            # 1 = outline/shadow, 3 = caixa opaca
    outline_w = 4
    shadow_w  = 2
    bold      = -1              # -1 = on em ASS

    if estilo == "AMARELO_CLASSICO":
        outline_w = 6
        shadow_w  = 0
    elif estilo == "POP_BRANCO":
        outline_w = 5
        shadow_w  = 0
    elif estilo == "BOX_HORMOZI":
        primary      = "&H00000000"   # texto preto
        back         = "&H00FFFFFF"   # fundo branco
        border_style = 3              # caixa opaca
        outline_w    = 8              # padding da caixa
        shadow_w     = 0
    elif estilo == "NEON_VERDE":
        outline_w = 4
        shadow_w  = 3
        back      = "&H0000FF00"      # sombra verde

    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {WIDTH}\n"
        f"PlayResY: {HEIGHT}\n"
        "ScaledBorderAndShadow: yes\n"
        "WrapStyle: 2\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{LEGENDA_FONT},{LEGENDA_FONT_SIZE},{primary},{secondary},{outline},{back},"
        f"{bold},0,0,0,100,100,0,0,{border_style},{outline_w},{shadow_w},2,{LEGENDA_MARGIN_H},{LEGENDA_MARGIN_H},{margin_v},1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def _agrupar_em_frases(palavras: list[dict], max_palavras: int = LEGENDA_MAX_PALAVRAS,
                       max_gap: float = 0.6) -> list[list[dict]]:
    """Quebra a lista de palavras em frases curtas (legendas)."""
    frases: list[list[dict]] = []
    atual: list[dict] = []
    for w in palavras:
        if atual:
            gap = w["start"] - atual[-1]["end"]
            if len(atual) >= max_palavras or gap > max_gap:
                frases.append(atual)
                atual = []
        atual.append(w)
    if atual:
        frases.append(atual)
    return frases


def _eventos_amarelo_classico(palavras: list[dict]) -> list[str]:
    """Frase visível inteira, palavra falada AMARELA."""
    frases = _agrupar_em_frases(palavras)
    out: list[str] = []
    for frase in frases:
        f_start = frase[0]["start"]
        f_end   = frase[-1]["end"] + 0.15
        # Um evento por palavra ativa, sobrepondo a frase no mesmo intervalo
        for i, w in enumerate(frase):
            partes = []
            for j, p in enumerate(frase):
                txt = _ass_escape(p["word"])
                if j == i:
                    # palavra atual em amarelo (&HAABBGGRR → amarelo = 00 00 FF FF)
                    partes.append(f"{{\\c&H0000FFFF&\\b1}}{txt}{{\\c&HFFFFFF&\\b0}}")
                else:
                    partes.append(txt)
            texto = " ".join(partes)
            out.append(f"Dialogue: 0,{_fmt_ts(w['start'])},{_fmt_ts(w['end'])},Default,,0,0,0,,{texto}")
        # entre fim da última palavra e f_end, mantém frase sem destaque
        ultima = frase[-1]
        if f_end > ultima["end"]:
            texto = " ".join(_ass_escape(p["word"]) for p in frase)
            out.append(f"Dialogue: 0,{_fmt_ts(ultima['end'])},{_fmt_ts(f_end)},Default,,0,0,0,,{texto}")
    return out


def _eventos_pop_branco(palavras: list[dict]) -> list[str]:
    """Só a palavra falada na tela, com escala 80→100% + fade."""
    out: list[str] = []
    for w in palavras:
        start = w["start"]
        end   = max(w["end"], start + 0.25)
        dur_ms = int((end - start) * 1000)
        anim_ms = min(120, dur_ms // 3)
        fade_in, fade_out = 60, 50
        tags = (
            f"{{\\fad({fade_in},{fade_out})"
            f"\\fscx80\\fscy80\\t(0,{anim_ms},\\fscx105\\fscy105)"
            f"\\t({anim_ms},{anim_ms+80},\\fscx100\\fscy100)\\b1}}"
        )
        texto = tags + _ass_escape(w["word"])
        out.append(f"Dialogue: 0,{_fmt_ts(start)},{_fmt_ts(end)},Default,,0,0,0,,{texto}")
    return out


def _eventos_box_hormozi(palavras: list[dict]) -> list[str]:
    """Caixa branca, 3 palavras por bloco, troca em sincronia com a fala."""
    out: list[str] = []
    blocos = _agrupar_em_frases(palavras, max_palavras=3, max_gap=0.8)
    for bloco in blocos:
        start = bloco[0]["start"]
        end   = bloco[-1]["end"] + 0.15
        texto = " ".join(_ass_escape(w["word"]).upper() for w in bloco)
        # \b1 negrito; cor já é preta na Style; caixa via BorderStyle=3
        out.append(f"Dialogue: 0,{_fmt_ts(start)},{_fmt_ts(end)},Default,,0,0,0,,{{\\b1}}{texto}")
    return out


def _eventos_neon_verde(palavras: list[dict]) -> list[str]:
    """Frase branca + palavra atual com stroke verde fluo e glow."""
    frases = _agrupar_em_frases(palavras)
    out: list[str] = []
    for frase in frases:
        for i, w in enumerate(frase):
            partes = []
            for j, p in enumerate(frase):
                txt = _ass_escape(p["word"])
                if j == i:
                    # palavra atual: stroke verde fluo grosso (&H0000FF00 = verde)
                    partes.append(f"{{\\3c&H0000FF00&\\bord10\\b1}}{txt}{{\\3c&H000000&\\bord4\\b0}}")
                else:
                    partes.append(txt)
            texto = " ".join(partes)
            out.append(f"Dialogue: 0,{_fmt_ts(w['start'])},{_fmt_ts(w['end'])},Default,,0,0,0,,{texto}")
    return out


_GERADORES = {
    "AMARELO_CLASSICO": _eventos_amarelo_classico,
    "POP_BRANCO":       _eventos_pop_branco,
    "BOX_HORMOZI":      _eventos_box_hormozi,
    "NEON_VERDE":       _eventos_neon_verde,
}


def gerar_ass(palavras: list[dict], estilo: str) -> Optional[str]:
    """Cria arquivo .ass em %TEMP% e devolve o path. None se nada a fazer."""
    if not palavras:
        return None
    if estilo not in _GERADORES:
        _safe_print(f"[subs] estilo desconhecido '{estilo}', usando default")
        estilo = ESTILOS_LEGENDA[0]

    header  = _ass_header(estilo)
    eventos = _GERADORES[estilo](palavras)
    if not eventos:
        return None

    fd, path = tempfile.mkstemp(suffix=".ass", prefix="subs_")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(header)
            f.write("\n".join(eventos))
            f.write("\n")
        return path
    except Exception as e:
        _safe_print(f"[subs] gerar_ass erro: {e}")
        try: os.unlink(path)
        except OSError: pass
        return None


# ── Queima com ffmpeg ─────────────────────────────────────────────────────────

def _path_ass_para_filter(p: str) -> str:
    """
    O filtro `subtitles` do ffmpeg precisa de path com escapes específicos no
    Windows. Backslashes precisam ser duplicados e ':' do drive precisa de
    backslash.
    """
    # Normaliza pra forward slashes (libass aceita)
    pp = p.replace("\\", "/")
    # Escapa ':' do drive C: → C\:
    pp = pp.replace(":", r"\:")
    return pp


def queimar_legenda(video_path: str, ass_path: str) -> bool:
    """Re-encoda o vídeo com a legenda queimada via libass. Usa NVENC."""
    from video_processor import CODEC_VIDEO, FFMPEG_PARAMS, GPU_AVAILABLE

    out_path = video_path + ".legendado.mp4"
    vf = f"subtitles='{_path_ass_para_filter(ass_path)}'"

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", video_path,
        "-vf", vf,
        "-c:v", CODEC_VIDEO,
        *FFMPEG_PARAMS,
        "-c:a", "copy",
        out_path,
    ]
    _safe_print(f"[burn] queimando legenda... ({CODEC_VIDEO})")
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=600)
        if r.returncode != 0:
            _safe_print(f"[burn] ffmpeg rc={r.returncode}:")
            _safe_print(r.stderr.decode("utf-8", errors="replace")[-500:])
            if os.path.exists(out_path):
                try: os.unlink(out_path)
                except OSError: pass
            return False
        os.replace(out_path, video_path)
        return True
    except Exception as e:
        _safe_print(f"[burn] erro: {e}")
        if os.path.exists(out_path):
            try: os.unlink(out_path)
            except OSError: pass
        return False


# ── Legenda a partir de texto + timing da narração (sem whisper) ──────────────

def gerar_ass_narracao(timings: list[tuple[str, float, float]], estilo: str) -> Optional[str]:
    """
    Gera ASS a partir de lista de (texto, start_sec, end_sec) da narração.
    Cada texto vira um evento Dialogue com o timing exato da narração.
    Usa o header do estilo selecionado (para manter fonte/cor consistente).
    """
    if not timings:
        return None
    if estilo not in _GERADORES:
        estilo = ESTILOS_LEGENDA[0]

    header = _ass_header(estilo)
    eventos: list[str] = []
    for texto, start, end in timings:
        if not texto.strip():
            continue
        t_start = _fmt_ts(start)
        t_end   = _fmt_ts(end)
        escaped = _ass_escape(texto.strip())
        eventos.append(f"Dialogue: 0,{t_start},{t_end},Default,,0,0,0,,{escaped}")

    if not eventos:
        return None

    fd, path = tempfile.mkstemp(suffix=".ass", prefix="subs_nar_")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(header)
            f.write("\n".join(eventos))
            f.write("\n")
        return path
    except Exception as e:
        _safe_print(f"[subs] gerar_ass_narracao erro: {e}")
        try: os.unlink(path)
        except OSError: pass
        return None


def aplicar_legenda_narracao(video_path: str,
                             timings: list[tuple[str, float, float]],
                             estilo: str,
                             progress_cb=None) -> bool:
    """
    Gera legenda diretamente do texto + timing das narrações.
    Não usa whisper — o ASS é montado com os textos exatos que o usuário escreveu.
    """
    ass = None
    try:
        if progress_cb: progress_cb("gerando ass")
        ass = gerar_ass_narracao(timings, estilo)
        if not ass:
            _safe_print("[subs] ASS de narração não gerado — pulando legenda")
            return False

        if progress_cb: progress_cb("burn")
        return queimar_legenda(video_path, ass)
    finally:
        if ass and os.path.exists(ass):
            try: os.unlink(ass)
            except OSError: pass


# ── API pública ───────────────────────────────────────────────────────────────

def aplicar_legenda(video_path: str, estilo: str,
                    progress_cb=None) -> bool:
    """
    Pipeline completo. True se a legenda foi queimada no vídeo, False se algum
    passo falhou (vídeo permanece original).

    progress_cb(fase: str) é chamado a cada etapa: "extraindo", "transcrevendo",
    "burn". Pode ser None.
    """
    wav = None
    ass = None
    try:
        if progress_cb: progress_cb("extraindo")
        wav = extrair_audio(video_path)
        if not wav:
            _safe_print("[subs] sem áudio extraído — pulando legenda")
            return False

        if progress_cb: progress_cb("transcrevendo")
        palavras = transcrever(wav)
        if not palavras:
            _safe_print("[subs] sem palavras transcritas — pulando legenda")
            return False

        ass = gerar_ass(palavras, estilo)
        if not ass:
            _safe_print("[subs] ASS não gerado — pulando legenda")
            return False

        if progress_cb: progress_cb("burn")
        return queimar_legenda(video_path, ass)
    finally:
        for tmp in (wav, ass):
            if tmp and os.path.exists(tmp):
                try: os.unlink(tmp)
                except OSError: pass
