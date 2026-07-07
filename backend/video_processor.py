import os
import time
import asyncio
import subprocess
from config import *
from moviepy import (
    VideoFileClip, ColorClip, CompositeVideoClip,
    ImageClip, TextClip,
)
from proglog import ProgressBarLogger
import yt_dlp

from narration import PIPER_AVAILABLE, gerar_wav, get_audio_duration
import subtitles

# ── GPU detection ─────────────────────────────────────────────────────────────

def _detectar_nvenc() -> bool:
    try:
        import tempfile
        tmp = os.path.join(tempfile.gettempdir(), "_nvenc_probe.mp4")
        r = subprocess.run(
            ["ffmpeg", "-y",
             "-f", "lavfi", "-i", "testsrc=duration=1:size=1280x720:rate=30",
             "-c:v", "h264_nvenc", "-b:v", "5M", tmp],
            capture_output=True, timeout=15,
        )
        if os.path.exists(tmp):
            os.remove(tmp)
        return r.returncode == 0
    except Exception:
        return False


GPU_AVAILABLE = _detectar_nvenc()

if GPU_AVAILABLE:
    CODEC_VIDEO   = "h264_nvenc"
    FFMPEG_PARAMS = [
        "-preset", "p4",
        "-rc",     "vbr",
        "-cq",     "23",
        "-b:v",    "8M",
        "-maxrate","12M",
        "-bufsize", "16M",
        "-map_metadata", "-1",
    ]
    print("[GPU] h264_nvenc — NVENC ativo")
else:
    CODEC_VIDEO   = "libx264"
    FFMPEG_PARAMS = ["-preset", "fast", "-crf", "23", "-map_metadata", "-1"]
    print("[CPU] libx264 — sem NVENC")

# ── Viral Intro ────────────────────────────────────────────────────────────────

NOTIFICATION_WAV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "notification.wav")
NOTIFICATION_DURATION_S = 0.25  # duraçãao fixa do notification.wav

def _get_fps(video_path: str) -> float:
    """Obtém o FPS de um vídeo via ffprobe."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=r_frame_rate",
             "-of", "default=noprint_wrappers=1:nokey=1", video_path],
            capture_output=True, text=True, timeout=15,
        )
        parts = r.stdout.strip().split("/")
        if len(parts) == 2 and float(parts[1]) > 0:
            return float(parts[0]) / float(parts[1])
        return 30.0
    except Exception:
        return 30.0


# ── Helpers para ASS ───────────────────────────────────────────────────────────

def _split_into_chunks(texto: str, max_width_px: int, font_size: int) -> list[str]:
    """Divide o texto em chunks que cabem em max_width_px, estimando ~0.65px por pt."""
    char_w = font_size * 0.65
    max_chars = max(1, int(max_width_px / char_w))
    words = texto.strip().split()
    if not words:
        return []
    chunks: list[str] = []
    cur: list[str] = []
    cur_len = 0
    for w in words:
        wlen = len(w) + (1 if cur else 0)
        if cur_len + wlen > max_chars and cur:
            chunks.append(" ".join(cur))
            cur = [w]
            cur_len = len(w)
        else:
            cur.append(w)
            cur_len += wlen
    if cur:
        chunks.append(" ".join(cur))
    return chunks


def _gerar_ass_intro_titulo(texto: str, dur_total: float, dur_max: float | None = None) -> str | None:
    """
    Gera um arquivo ASS temporário com o título exibido palavra por palavra,
    centralizado na tela (estilo TikTok). A palavra atual aparece destacada
    em amarelo, as demais em branco.
    Suporta:
      - divisão em chunks para caber em ~80% da largura
      - cada chunk vira um slide sequencial
      - animação de entrada (slide lateral 50ms)
      - animação de saída (contração 50ms)
    Retorna o caminho do .ass ou None.
    """
    import tempfile

    font_size = 100
    max_w = int(WIDTH * 0.80)
    chunks = _split_into_chunks(texto, max_w, font_size)
    if not chunks:
        return None
    n_chunks = len(chunks)

    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {WIDTH}\n"
        f"PlayResY: {HEIGHT}\n"
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,DejaVu Sans,{font_size},&H00FFFFFF,&H0000FFFF,"
        "&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,5,2,5,0,0,0,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    eventos: list[str] = []
    center_x = WIDTH // 2
    center_y = HEIGHT // 2
    fade_out_ms = 40
    min_chunk_dur = 0.6

    chunk_durs: list[float] = []
    for chunk in chunks:
        nw = len(chunk.split())
        chunk_durs.append(max(min_chunk_dur, nw * 0.25))
    total_min = sum(chunk_durs)
    if dur_max is None:
        dur_max = dur_total
    effective = max(dur_total, min(dur_max, total_min))
    scale = effective / total_min if total_min > 0 else 1.0
    chunk_offset = 0.0
    for ci, chunk in enumerate(chunks):
        words = chunk.split()
        nw = len(words)
        chunk_dur = chunk_durs[ci] * scale
        chunk_start = chunk_offset
        chunk_end = chunk_start + chunk_dur
        chunk_offset = chunk_end

        word_dur = chunk_dur / nw if nw > 0 else chunk_dur
        for wi in range(nw):
            w_start = chunk_start + wi * word_dur
            w_end = chunk_start + (wi + 1) * word_dur
            if wi == nw - 1:
                w_end = chunk_end

            partes: list[str] = []
            for j, pw in enumerate(words):
                if j == wi:
                    partes.append(f"{{\\c&H0000FFFF&\\b1}}{pw}{{\\c&HFFFFFF&\\b0}}")
                else:
                    partes.append(pw)
            linha = " ".join(partes)

            anim = ""
            if wi == 0:
                anim += f"{{\\move(-1200,{center_y},{center_x},{center_y},0,5)}}"
            else:
                anim += f"{{\\pos({center_x},{center_y})}}"

            if wi == nw - 1:
                anim += f"{{\\fad(0,{fade_out_ms})}}"

            eventos.append(
                f"Dialogue: 0,{_fmt_ts(w_start)},{_fmt_ts(w_end)},"
                f"Default,,0,0,0,,{anim}{linha}"
            )

    fd, path = tempfile.mkstemp(suffix=".ass", prefix="intro_titulo_")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(header)
            f.write("\n".join(eventos))
            f.write("\n")
        return path
    except Exception as e:
        print(f"[viral-ass] erro ao gerar ASS: {e}")
        if os.path.exists(path):
            try: os.unlink(path)
            except OSError: pass
        return None


def _gerar_ass_narracao_tiktok(
    timings: list[tuple[str, float, float]],
    font_size: int,
) -> str | None:
    """
    Gera ASS com legenda estilo TikTok (palavra-por-palavra, destaque amarelo)
    para cada bloco de narração personalizada.
    timings: [(texto, start_sec, end_sec)]
    A posição Y é fixa em LEGENDA_Y_FRAC (mesma da legenda automática).
    Retorna caminho do .ass ou None.
    """
    import tempfile

    if not timings:
        return None

    max_w = int(WIDTH * 0.80)

    # Estilo base
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {WIDTH}\n"
        f"PlayResY: {HEIGHT}\n"
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{LEGENDA_FONT},{font_size},&H00FFFFFF,&H0000FFFF,"
        "&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,5,2,2,0,0,0,1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    eventos: list[str] = []
    fade_out_ms = 40
    min_chunk_dur = 0.6
    y_px = max(20, min(HEIGHT - 20, int(LEGENDA_Y_FRAC * HEIGHT)))

    for texto, start, end in timings:
        texto = texto.strip()
        if not texto:
            continue
        dur = end - start
        if dur <= 0:
            continue

        chunks = _split_into_chunks(texto, max_w, font_size)
        if not chunks:
            continue

        # Distribui tempo entre chunks sem overlap
        chunk_durs: list[float] = []
        for chunk in chunks:
            nw = len(chunk.split())
            chunk_durs.append(max(min_chunk_dur, nw * 0.25))
        total_min = sum(chunk_durs)
        scale = dur / total_min if total_min > 0 else 1.0
        chunk_offset = start
        for ci, chunk in enumerate(chunks):
            words = chunk.split()
            nw = len(words)
            chunk_dur = chunk_durs[ci] * scale
            c_start = chunk_offset
            c_end = c_start + chunk_dur
            chunk_offset = c_end

            word_dur = chunk_dur / nw if nw > 0 else chunk_dur
            for wi in range(nw):
                w_start = c_start + wi * word_dur
                w_end = c_start + (wi + 1) * word_dur
                if wi == nw - 1:
                    w_end = c_end

                partes: list[str] = []
                for j, pw in enumerate(words):
                    if j == wi:
                        partes.append(
                            f"{{\\c&H0000FFFF&\\b1}}{pw}{{\\c&HFFFFFF&\\b0}}"
                        )
                    else:
                        partes.append(pw)
                linha = " ".join(partes)

                anim = ""
                if wi == 0:
                    anim += f"{{\\move(-1200,{y_px},{WIDTH // 2},{y_px},0,5)}}"
                else:
                    anim += f"{{\\pos({WIDTH // 2},{y_px})}}"

                if wi == nw - 1:
                    anim += f"{{\\fad(0,{fade_out_ms})}}"

                eventos.append(
                    f"Dialogue: 0,{_fmt_ts(w_start)},{_fmt_ts(w_end)},"
                    f"Default,,0,0,0,,{anim}{linha}"
                )

    if not eventos:
        return None

    fd, path = tempfile.mkstemp(suffix=".ass", prefix="nar_tiktok_")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(header)
            f.write("\n".join(eventos))
            f.write("\n")
        return path
    except Exception as e:
        print(f"[tiktok-ass] erro ao gerar ASS: {e}")
        if os.path.exists(path):
            try: os.unlink(path)
            except OSError: pass
        return None


def _adicionar_intro_viral(
    video_path: str,
    item: dict,
    raw_video_path: str | None = None,
    overlay_path: str | None = None,
) -> tuple[bool, float]:
    """
    Prependes a viral intro ao vídeo:
      - extrai 1 frame do raw, aplica blur como imagem
      - overlay + título + legenda palavra-por-palavra em cima
      - narra o título (Piper)
      - whoosh sincronizado com fade preto no final
      - concatena intro + vídeo principal

    Tudo em passos separados (imagem, vídeo, concat) pra evitar
    o erro ffmpeg "Cannot allocate memory" (-12) do filter_complex
    gigante que usava loop+boxblur in-memory.
    """
    from narration import PIPER_AVAILABLE, gerar_wav, get_audio_duration
    import tempfile, shutil

    title_text = (item.get("title") or "").strip()
    if not title_text:
        print("[viral] título vazio — pulando intro")
        return False, 0.0

    voice = item.get("voice", "padrao")
    if voice == "padrao" and not PIPER_AVAILABLE:
        print("[viral] Piper indisponível — pulando intro")
        return False, 0.0

    wav_narracao = gerar_wav(title_text, voice)
    if not wav_narracao:
        print("[viral] falha ao gerar WAV da narração")
        return False, 0.0

    # ── Whoosh ───────────────────────────────────────────────────────────
    WHOOSH_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "whoosh.mp3")
    WHOOSH_SRC = r"C:\Users\78787\Downloads\0630 (2).MP3"
    if not os.path.exists(WHOOSH_FILE):
        try:
            shutil.copy2(WHOOSH_SRC, WHOOSH_FILE)
            print(f"[viral] whoosh copiado para {WHOOSH_FILE}")
        except Exception as e:
            print(f"[viral] erro ao copiar whoosh: {e}")
            return False, 0.0

    ass_path: str | None = None
    title_tmp: str | None = None
    tmpdir: str | None = None

    try:
        dur_narracao = get_audio_duration(wav_narracao)
        if dur_narracao <= 0:
            dur_narracao = max(1.5, len(title_text) * 0.08)

        FADE_DUR = 0.12
        whoosh_start = dur_narracao
        trans_start = whoosh_start
        whoosh_play = FADE_DUR + 0.6
        intro_dur = trans_start + whoosh_play
        fps = 30

        # ── Gera ASS da legenda centralizada ──
        ass_path = _gerar_ass_intro_titulo(title_text, dur_narracao)

        # ── Prepara título para drawtext ──────────────────────────────────
        font_label = item.get("font", FONT_DEFAULT)
        fp = font_path(font_label).replace("\\", "/").replace(":", "\\:")
        cor_label  = item.get("cor_titulo", COR_TITULO_DEFAULT)
        cor_hex    = cor_titulo_hex(cor_label)
        stroke_cor = "white" if cor_label == "Preto" else "black"
        border_w   = 6 if item.get("titulo_borda", True) else 0
        title_y    = item.get("title_y", TITLE_Y_DEFAULT)

        fd, title_tmp = tempfile.mkstemp(suffix=".txt", prefix="viral_title_")
        os.close(fd)
        with open(title_tmp, "w", encoding="utf-8") as f:
            f.write(title_text)

        # ── Cria pasta temp ──────────────────────────────────────────────
        tmpdir = tempfile.mkdtemp(prefix="viral_intro_")
        raw_src = raw_video_path or video_path

        # ══════════════════════════════════════════════════════════════════
        # PASSO 1: extrair 1 frame do raw como imagem
        # ══════════════════════════════════════════════════════════════════
        frame_path = os.path.join(tmpdir, "frame.jpg")
        r = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-i", raw_src, "-frames:v", "1", "-q:v", "3", frame_path],
            capture_output=True, timeout=30,
        )
        if r.returncode != 0 or not os.path.exists(frame_path):
            print(f"[viral] passo 1 falhou: extrair frame")
            return False, 0.0

        # ══════════════════════════════════════════════════════════════════
        # PASSO 2: blur na imagem (sem loop, sem GPU, sem memória extra)
        # ══════════════════════════════════════════════════════════════════
        blurred_path = os.path.join(tmpdir, "blurred.jpg")
        r = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-i", frame_path,
             "-vf", "boxblur=lr=12:lp=2",
             blurred_path],
            capture_output=True, timeout=30,
        )
        if r.returncode != 0 or not os.path.exists(blurred_path):
            print(f"[viral] passo 2 falhou: blur da imagem")
            return False, 0.0

        # ══════════════════════════════════════════════════════════════════
        # PASSO 3: gerar vídeo da intro
        #   - fade SÓ no fundo (blurred), overlay/título/subs ficam nítidos
        #   - narração toca de imediato, whoosh atrasado pro final
        # ══════════════════════════════════════════════════════════════════
        intro_video = os.path.join(tmpdir, "intro.mp4")

        inputs = [
            "-loop", "1", "-t", str(intro_dur), "-framerate", str(fps),
            "-i", blurred_path,
        ]
        if overlay_path:
            inputs += [
                "-loop", "1", "-t", str(intro_dur), "-framerate", str(fps),
                "-i", overlay_path,
            ]
        inputs += ["-i", wav_narracao, "-i", WHOOSH_FILE]

        # Índices dos inputs no ffmpeg
        if overlay_path:
            ov_i, nar_i, whoosh_i = 1, 2, 3
        else:
            ov_i = None
            nar_i, whoosh_i = 1, 2

        whoosh_delay_ms = int(whoosh_start * 1000)
        title_esc = title_tmp.replace("\\", "/").replace(":", "\\:")

        # ── Monta filter complex ────────────────────────────────────────
        # Fundo: scale+crop → split (stable + fade) → concat
        fc = (
            f"[0:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={WIDTH}:{HEIGHT},"
            f"setpts=N/{fps}/TB[bg];"
            f"[bg]split=2[bg_s][bg_f];"
            f"[bg_s]trim=end={trans_start},setpts=PTS-STARTPTS[bg_stable];"
            f"[bg_f]trim=start={trans_start},setpts=PTS-STARTPTS,"
            f"fade=out:st=0:d={FADE_DUR}:color=black[bg_faded];"
            f"[bg_stable][bg_faded]concat=n=2:v=1:a=0[bg_final]"
        )

        # Overlay PNG em cima do fundo (fica nítido durante o fade)
        if ov_i is not None:
            fc += (
                f";[{ov_i}:v]setpts=N/{fps}/TB[ov_loop];"
                f"[bg_final][ov_loop]overlay=0:0[with_ov]"
            )
            src_label = "with_ov"
        else:
            src_label = "bg_final"

        # Título fixo (drawtext)
        fc += (
            f";[{src_label}]drawtext="
            f"textfile='{title_esc}':"
            f"fontfile='{fp}':fontsize={TITLE_FONT_SIZE}:"
            f"fontcolor={cor_hex}:bordercolor={stroke_cor}:borderw={border_w}:"
            f"x=(w-text_w)/2:y={title_y}[with_title]"
        )

        # ASS da legenda palavra-por-palavra
        if ass_path:
            ass_esc = ass_path.replace("\\", "/").replace(":", "\\:")
            fc += f";[with_title]subtitles='{ass_esc}'[final_v]"
        else:
            fc += f";[with_title]copy[final_v]"

        # Áudio: whoosh atrasado, narração imediata, mix
        fc += (
            f";[{whoosh_i}:a]atrim=end={whoosh_play},asetpts=PTS-STARTPTS,"
            f"adelay={whoosh_delay_ms}|{whoosh_delay_ms},"
            f"volume=2.0[whoosh_del];"
            f"[{nar_i}:a][whoosh_del]"
            f"amix=inputs=2:duration=longest:dropout_transition=0,"
            f"aformat=sample_fmts=s16p:channel_layouts=stereo[final_a]"
        )

        cmd = (
            ["ffmpeg", "-y", "-loglevel", "error"]
            + inputs
            + ["-filter_complex", fc]
            + ["-map", "[final_v]", "-map", "[final_a]"]
            + ["-c:v", CODEC_VIDEO] + FFMPEG_PARAMS
            + ["-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100"]
            + ["-shortest", intro_video]
        )

        r = subprocess.run(cmd, capture_output=True, timeout=300)
        if r.returncode != 0 or not os.path.exists(intro_video):
            print(f"[viral] passo 3 falhou (rc={r.returncode}):")
            print(r.stderr.decode("utf-8", errors="replace")[-500:])
            return False, 0.0

        # ══════════════════════════════════════════════════════════════════
        # PASSO 4: concatenar intro + vídeo principal
        # ══════════════════════════════════════════════════════════════════
        out_path = video_path + ".viral.mp4"
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", intro_video,
            "-i", video_path,
            "-filter_complex",
            "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]",
            "-map", "[outv]", "-map", "[outa]",
            "-c:v", CODEC_VIDEO, *FFMPEG_PARAMS,
            "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
            out_path,
        ]
        r = subprocess.run(cmd, capture_output=True, timeout=300)
        if r.returncode != 0:
            print(f"[viral] passo 4 falhou (rc={r.returncode}):")
            print(r.stderr.decode("utf-8", errors="replace")[-500:])
            if os.path.exists(out_path):
                try: os.unlink(out_path)
                except OSError: pass
            return False, 0.0

        os.replace(out_path, video_path)
        print(f"[viral] intro adicionada ({intro_dur:.1f}s, fade {FADE_DUR}s)")
        return True, intro_dur

    except Exception as e:
        print(f"[viral] erro: {e}")
        return False, 0.0
    finally:
        if tmpdir and os.path.isdir(tmpdir):
            shutil.rmtree(tmpdir, ignore_errors=True)
        for p in [wav_narracao, ass_path, title_tmp]:
            if p and os.path.exists(p):
                try: os.unlink(p)
                except OSError: pass


# ── Freeze frame no meio do vídeo para narrações personalizadas ─────────────

def _inserir_freeze_frame_com_narracao(video_path: str, start_sec: float,
                                        wav_narracao: str) -> tuple[bool, float]:
    """
    Insere um freeze frame em `start_sec` segundos no vídeo, com a
    narração tocando durante o freeze. O vídeo é sobrescrito em sucesso.
    Retorna (sucesso, duracao_freeze).
    """
    from narration import get_audio_duration

    dur_narracao = get_audio_duration(wav_narracao)
    if dur_narracao <= 0:
        dur_narracao = max(1.5, 0.08 * 20)

    gap = 0.1
    freeze_dur = gap + dur_narracao

    fps = _get_fps(video_path)
    freeze_frames = max(2, int(round(freeze_dur * fps)))
    loop_n = max(1, freeze_frames - 1)
    gap_delay_ms = int(gap * 1000)

    out_path = video_path + ".freeze.mp4"

    filter_complex = (
        f"[0:v]trim=end={start_sec}[part1_v];"
        f"[0:v]trim=start={start_sec},setpts=PTS-STARTPTS[after_trim];"
        f"[after_trim]split=2[after_v][freeze_src];"
        f"[freeze_src]select='eq(n,0)',loop=loop={loop_n}:size=1,setpts=N/{fps}/TB[freeze_v];"
        f"[0:a]atrim=end={start_sec}[part1_a];"
        f"[0:a]atrim=start={start_sec},asetpts=PTS-STARTPTS[after_a];"
        f"[1:a]adelay={gap_delay_ms}|{gap_delay_ms}[nar_del];"
        f"[part1_v][part1_a][freeze_v][nar_del][after_v][after_a]"
        f"concat=n=3:v=1:a=1[outv][outa]"
    )

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", video_path,
        "-i", wav_narracao,
        "-filter_complex", filter_complex,
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", CODEC_VIDEO,
        *FFMPEG_PARAMS,
        "-c:a", "aac",
        "-b:a", "192k",
        "-ac", "2",
        "-ar", "44100",
        out_path,
    ]

    try:
        r = subprocess.run(cmd, capture_output=True, timeout=300)
        if r.returncode != 0:
            print(f"[freeze] ffmpeg falhou (rc={r.returncode}):")
            print(r.stderr.decode("utf-8", errors="replace")[-500:])
            if os.path.exists(out_path):
                try: os.unlink(out_path)
                except OSError: pass
            return False, 0.0
        os.replace(out_path, video_path)
        print(f"[freeze] freeze inserido em {start_sec:.1f}s (duração {freeze_dur:.1f}s)")
        return True, freeze_dur
    except Exception as e:
        print(f"[freeze] erro: {e}")
        if os.path.exists(out_path):
            try: os.unlink(out_path)
            except OSError: pass
        return False, 0.0


# ── Legenda personalizada com Y position por evento ─────────────────────────

def _fmt_ts(t: float) -> str:
    """Formato ASS: H:MM:SS.cs (centissegundos)."""
    if t < 0: t = 0.0
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int(round((t - int(t)) * 100))
    if cs == 100: cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _queimar_legenda_personalizada(video_path: str,
                                    timings: list[tuple[str, float, float, float]],
                                    estilo: str) -> bool:
    """
    Queima legenda com Y position customizado por evento.
    timings: [(texto, start, end, y_frac)] — y_frac é fração 0..1 da altura.
    estilo: mesmo estilo das legendas TikTok (AMARELO_CLASSICO, etc).
    """
    import tempfile

    if not timings:
        return False

    margin_v = int(HEIGHT * (1.0 - LEGENDA_Y_FRAC))

    # Cores padrão do estilo
    primary   = "&H00FFFFFF"
    secondary = "&H00FFFFFF"
    outline   = "&H00000000"
    back      = "&H00000000"
    border_style = 1
    outline_w = 5
    shadow_w  = 2
    bold      = -1

    if estilo == "AMARELO_CLASSICO":
        outline_w = 6; shadow_w = 0
    elif estilo == "POP_BRANCO":
        outline_w = 5; shadow_w = 0
    elif estilo == "BOX_HORMOZI":
        primary = "&H00000000"; back = "&H00FFFFFF"
        border_style = 3; outline_w = 8; shadow_w = 0
    elif estilo == "NEON_VERDE":
        outline_w = 4; shadow_w = 3; back = "&H0000FF00"

    ass_lines: list[str] = []
    ass_lines.append("[Script Info]")
    ass_lines.append("ScriptType: v4.00+")
    ass_lines.append(f"PlayResX: {WIDTH}")
    ass_lines.append(f"PlayResY: {HEIGHT}")
    ass_lines.append("ScaledBorderAndShadow: yes")
    ass_lines.append("WrapStyle: 2")
    ass_lines.append("")
    ass_lines.append("[V4+ Styles]")
    ass_lines.append(
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding"
    )
    ass_lines.append(
        f"Style: Default,{LEGENDA_FONT},{LEGENDA_FONT_SIZE},{primary},{secondary},"
        f"{outline},{back},{bold},0,0,0,100,100,0,0,{border_style},{outline_w},"
        f"{shadow_w},2,{LEGENDA_MARGIN_H},{LEGENDA_MARGIN_H},{margin_v},1"
    )
    ass_lines.append("")
    ass_lines.append("[Events]")
    ass_lines.append("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text")

    for texto, start, end, y_frac in timings:
        if not texto.strip():
            continue
        y_px = max(20, min(HEIGHT - 20, int(y_frac * HEIGHT)))
        escaped = texto.strip().replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
        pos_tag = f"{{\\an8\\pos({WIDTH // 2},{y_px})}}"
        linha = f"Dialogue: 0,{_fmt_ts(start)},{_fmt_ts(end)},Default,,0,0,0,,{pos_tag}{escaped}"
        ass_lines.append(linha)

    if len(ass_lines) <= 9:
        return False

    fd, ass_path = tempfile.mkstemp(suffix=".ass", prefix="subs_leg_")
    os.close(fd)
    try:
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write("\n".join(ass_lines))
            f.write("\n")

        ok = subtitles.queimar_legenda(video_path, ass_path)
        return ok
    except Exception as e:
        print(f"[subs_personalizada] erro: {e}")
        return False
    finally:
        if os.path.exists(ass_path):
            try: os.unlink(ass_path)
            except OSError: pass


# ── Título index ──────────────────────────────────────────────────────────────

_titulo_index = 0

def proximo_titulo() -> str:
    global _titulo_index
    t = TITULOS_PADRAO[_titulo_index % len(TITULOS_PADRAO)]
    _titulo_index += 1
    return t

# ── Download ──────────────────────────────────────────────────────────────────

def _ydl_opts(**kw) -> dict:
    """Retorna dict de opções padrão do yt-dlp, mesclado com **kw.
    Se COOKIES_FILE existir, inclui cookiefile."""
    base = {
        "quiet": True, "noplaylist": True, "no_warnings": True,
    }
    if os.path.exists(COOKIES_FILE):
        base["cookiefile"] = COOKIES_FILE
    base.update(kw)
    return base


def baixar_video(url: str, progress_hook=None) -> str:
    """
    Baixa o vídeo via yt-dlp. Se `progress_hook(fraction)` for passado,
    será chamado com 0.0..1.0 conforme o download avança.
    """
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)

    def _hook(d):
        if not progress_hook or d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        done  = d.get("downloaded_bytes") or 0
        if total > 0:
            try:
                progress_hook(min(0.999, done / total))
            except Exception:
                pass

    ydl_opts = {
        "outtmpl": os.path.join(DOWNLOAD_DIR, "%(id)s.%(ext)s"),
        "format":  "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best",
        "merge_output_format": "mp4",
        "quiet":      True,
        "noplaylist": True,
        "no_warnings": True,
        "progress_hooks": [_hook] if progress_hook else [],
    }
    if os.path.exists(COOKIES_FILE):
        ydl_opts["cookiefile"] = COOKIES_FILE
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        if progress_hook:
            try: progress_hook(1.0)
            except Exception: pass
        return os.path.join(DOWNLOAD_DIR, f"{info['id']}.mp4")


# ── Logger MoviePy → emite progresso da exportação ────────────────────────────

class _EmitLogger(ProgressBarLogger):
    """
    Logger compatível com proglog (usado pelo MoviePy) que chama
    on_fraction(0.0..1.0) sempre que a barra de progresso de uma tarefa muda.

    O MoviePy cria múltiplas "barras" (audio + video). Usamos a barra 't'
    do moviepy_video que é a mais longa e dominante.
    """
    def __init__(self, on_fraction):
        super().__init__()
        self.on_fraction = on_fraction
        self._last       = -1.0

    def bars_callback(self, bar, attr, value, old_value=None):
        # Só nos importa o "index" (frame atual) da barra principal de vídeo
        if attr != "index":
            return
        b = self.bars.get(bar) or {}
        total = b.get("total") or 0
        if total <= 0:
            return
        frac = max(0.0, min(1.0, value / total))
        # debounce: emite só se variar 1%
        if frac - self._last >= 0.01 or frac >= 0.999:
            self._last = frac
            try:
                self.on_fraction(frac)
            except Exception:
                pass

# ── Edição ────────────────────────────────────────────────────────────────────

def to_vertical(clip, video_y: int = 0):
    if clip.w > clip.h:
        target_w = int(WIDTH * VIDEO_SCALE_RATIO_VERTICAL)
        clip = clip.resized(width=target_w)
    else:
        target_h = int(HEIGHT * VIDEO_SCALE_RATIO_VERTICAL)
        clip = clip.resized(height=target_h)
    
    y_pos = (HEIGHT - clip.h) // 2 + video_y

    bg = ColorClip(size=(WIDTH, HEIGHT), color=(0, 0, 0), duration=clip.duration)
    return CompositeVideoClip([bg, clip.with_position(("center", y_pos))],
                               size=(WIDTH, HEIGHT))


def gerar_titulo_clip(texto: str, duracao: float,
                      font_label: str = FONT_DEFAULT,
                      title_y: int = TITLE_Y_DEFAULT,
                      cor_label: str = COR_TITULO_DEFAULT,
                      borda: bool = True):
    if not texto.strip():
        return None
    cor    = cor_titulo_hex(cor_label)
    # Contorno: branco se o texto for escuro (preto), senão preto.
    stroke = "white" if cor_label == "Preto" else "black"
    sw     = 6 if borda else 0
    return (
        TextClip(
            text=texto,
            font=font_path(font_label),
            font_size=TITLE_FONT_SIZE,
            color=cor,
            stroke_color=(stroke if borda else None),
            stroke_width=sw,
            size=(int(WIDTH * TITLE_WIDTH_RATIO), None),
            # margem (esq, topo, dir, baixo): espaço extra embaixo evita
            # cortar os rabinhos de fontes manuscritas (Caveat) + a borda.
            margin=(10, 4, 10, 36),
            method="caption",
            text_align="center",
        )
        .with_duration(duracao)
        .with_position(("center", int(title_y)))
    )


def obter_duracao(url: str) -> float | None:
    """Retorna a duração do vídeo em segundos via yt-dlp (sem download)."""
    try:
        with yt_dlp.YoutubeDL(_ydl_opts()) as ydl:
            info = ydl.extract_info(url, download=False)
        return info.get("duration")
    except Exception as e:
        print(f"[duration] erro: {e}")
        return None


def extrair_frame(url: str, out_path: str, t: float = 3.0) -> bool:
    """Extrai 1 frame do vídeo (sem baixar tudo) via stream URL + ffmpeg.
    Salva JPG em out_path. Retorna True/False. Pensado pra rodar em thread."""
    try:
        ydl_opts = _ydl_opts(
            format="best[ext=mp4][height<=720]/best[ext=mp4]/best",
        )
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
        stream_url = info.get("url")
        if not stream_url and info.get("requested_formats"):
            stream_url = info["requested_formats"][0].get("url")
        if not stream_url:
            return False

        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", str(t), "-i", stream_url,
            "-frames:v", "1", "-q:v", "3",
            out_path,
        ]
        r = subprocess.run(cmd, capture_output=True, timeout=60)
        return r.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 500
    except Exception as e:
        print(f"[frame] erro: {e}")
        return False


def gerar_tarja_clips(tarja: dict, duracao: float) -> list:
    """Gera os clips da tarja (caixa preta + texto opcional)."""
    if not tarja or not tarja.get("ativo"):
        return []

    x = int(float(tarja.get("x", 0)) * WIDTH)
    y = int(float(tarja.get("y", 0)) * HEIGHT)
    w = max(8, int(float(tarja.get("w", 0.2)) * WIDTH))
    h = max(8, int(float(tarja.get("h", 0.05)) * HEIGHT))

    caixa = (ColorClip(size=(w, h), color=(0, 0, 0))
             .with_duration(duracao)
             .with_position((x, y)))
    clips = [caixa]

    texto = (tarja.get("texto") or "").strip()
    if texto:
        fs = max(16, int(h * 0.55))   # tamanho da fonte ~55% da altura da caixa
        try:
            txt = (TextClip(text=texto, font=FONT_PATH, font_size=fs,
                            color="white", method="caption",
                            size=(w - 10, h - 6), text_align="center")
                   .with_duration(duracao)
                   .with_position((x + 5, y + 3)))
            clips.append(txt)
        except Exception as e:
            print(f"[tarja] texto falhou: {e}")
    return clips


def aplicar_filtro(clip, filtro: str):
    """Aplica filtro visual ao vídeo (não afeta máscara/título)."""
    if not filtro or filtro == "Nenhum":
        return clip
    from moviepy import vfx
    if filtro == "Preto e Branco":
        return clip.with_effects([vfx.BlackAndWhite()])
    if filtro == "Suave":
        return clip.with_effects([
            vfx.LumContrast(lum=10, contrast=-0.10),
            vfx.GammaCorrection(gamma=0.92),
        ])
    return clip

# ── Mixagem de narração ───────────────────────────────────────────────────────

def _mix_narracao_titulo(video_path: str, wav_titulo: str) -> bool:
    """
    Mixa a narração do título sobre o áudio original do vídeo em `video_path`,
    com delay NARRATION_DELAY_S e ducking do original para NARRATION_DUCK_VOLUME
    durante a fala. Re-encoda só o áudio (vídeo é copiado). Sobrescreve
    `video_path` em sucesso. Retorna True/False.
    """
    duracao_tts = get_audio_duration(wav_titulo)
    if duracao_tts <= 0:
        print("[TTS] Duração do WAV é 0, abortando mix")
        return False

    delay_s   = float(NARRATION_DELAY_S)
    duck      = float(NARRATION_DUCK_VOLUME)
    fade_s    = max(0.0, float(NARRATION_FADE_S))
    delay_ms  = int(delay_s * 1000)
    fim_fala  = delay_s + duracao_tts

    # Áudio original: rampa suave entrando e saindo do ducking.
    #
    #   volume
    #     1 ┐────╲                           ╱────  (1.0 antes/depois)
    #       │     ╲                         ╱
    #   duck│      ╲_______________________╱        (duck enquanto fala)
    #       └────────┬─────────────────────┬──────► t
    #         delay_s│                     │fim_fala
    #
    # A rampa de descida fica centrada em delay_s, com duração fade_s.
    # A rampa de subida fica centrada em fim_fala, mesma duração.
    # inside(t) = down(t) - up(t)  ∈ [0,1]
    # vol(t)    = 1 - inside(t) * (1 - duck)
    if delay_s <= 0:
        # Sem delay: volume já começa em duck, só sobe no final com fade
        if fade_s <= 0:
            vol_expr = f"if(lt(t,{fim_fala}),{duck},1)"
        else:
            vol_expr = (
                f"if(lt(t,{fim_fala}),{duck},"
                f"min(1,{duck}+(t-{fim_fala})/{fade_s}))"
            )
    elif fade_s <= 0:
        vol_expr = (
            f"if(lt(t,{delay_s}),1,"
            f"if(lt(t,{fim_fala}),{duck},1))"
        )
    else:
        half  = fade_s / 2.0
        depth = 1.0 - duck
        down  = f"clip((t-({delay_s - half}))/{fade_s},0,1)"
        up    = f"clip((t-({fim_fala - half}))/{fade_s},0,1)"
        vol_expr = f"1-({down}-{up})*{depth}"
    filter_complex = (
        f"[0:a]volume='{vol_expr}':eval=frame[orig];"
        f"[1:a]adelay={delay_ms}|{delay_ms}[tts];"
        f"[orig][tts]amix=inputs=2:duration=first:dropout_transition=0[final]"
    )

    out_path = video_path + ".narrado.mp4"
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", wav_titulo,
        "-filter_complex", filter_complex,
        "-map", "0:v:0",
        "-map", "[final]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ac", "2",
        "-ar", "44100",
        "-shortest",
        out_path,
    ]

    try:
        r = subprocess.run(cmd, capture_output=True, timeout=120)
        if r.returncode != 0:
            print(f"[TTS] FFmpeg mix falhou (rc={r.returncode}):")
            print(r.stderr.decode("utf-8", errors="replace")[-500:])
            if os.path.exists(out_path):
                try: os.unlink(out_path)
                except OSError: pass
            return False
        os.replace(out_path, video_path)
        return True
    except Exception as e:
        print(f"[TTS] Erro no mix: {e}")
        if os.path.exists(out_path):
            try: os.unlink(out_path)
            except OSError: pass
        return False


def _mix_multiplas_narracoes(video_path: str,
                              narracoes: list[dict]) -> list[tuple[str, float, float]]:
    """
    Mixa múltiplas narrações sobre o áudio original.
    cada dict: {text, start_sec}
    Gera WAVs via Piper, atrasa cada uma para start_sec, aplica ducking
    no original durante cada segmento de fala, e mixa tudo.
    Sobrescreve video_path.
    Retorna lista de (texto, start_ajustado, end_ajustado) para gerar legenda,
    ou lista vazia se falhou.
    """
    if not narracoes:
        return []

    duck   = float(NARRATION_DUCK_VOLUME)
    fade_s = max(0.0, float(NARRATION_FADE_S))

    # 1. Gerar WAVs + medir durações
    wavs: list[tuple[str, float, float, str]] = []  # (path, start_sec, duration, text)
    for n in narracoes:
        texto = (n.get("text") or "").strip()
        if not texto:
            continue
        voice = n.get("voice", "padrao")
        wav = gerar_wav(texto, voice)
        if not wav:
            continue
        dur = get_audio_duration(wav)
        if dur <= 0:
            try: os.unlink(wav)
            except OSError: pass
            continue
        wavs.append((wav, float(n.get("start_sec", 0)), dur, texto))

    if not wavs:
        return []

    # 2. Ordenar por start_sec e ajustar para evitar sobreposição (fila)
    #    Cada narração começa no seu start_sec OU após o término da anterior,
    #    o que for maior — nunca duas narrações tocam ao mesmo tempo.
    wavs.sort(key=lambda x: x[1])
    timings: list[tuple[str, float, float]] = []
    prev_end = 0.0
    adjusted_wavs: list[tuple[str, float, float, str]] = []
    for wav_path, s, d, txt in wavs:
        effective_start = max(s, prev_end)
        adjusted_wavs.append((wav_path, effective_start, d, txt))
        timings.append((txt, effective_start, effective_start + d))
        prev_end = effective_start + d
    wavs = adjusted_wavs
    #    Montar expr: if(lt(t,s1),1, if(lt(t,e1),duck, if(lt(t,s2),1, ...)))
    vol_parts: list[str] = []
    prev_end = 0.0
    for wav_path, s, d, _txt in wavs:
        e = s + d
        if s > prev_end and prev_end > 0:
            vol_parts.append(f"if(lt(t,{s}),1,")
        elif s > 0 and prev_end == 0:
            vol_parts.append(f"if(lt(t,{s}),1,")
        vol_parts.append(f"if(lt(t,{e}),{duck},")
        prev_end = e
    vol_parts.append("1" + ")" * len(vol_parts))
    vol_expr = "".join(vol_parts)

    # 3. Montar filter_complex
    #    [0:a]volume=... [orig]
    #    [1:a]adelay=... [wav0]
    #    [2:a]adelay=... [wav1]
    #    ...
    #    [orig][wav0][wav1]...amix=inputs=N [final]
    filtros: list[str] = []
    filtros.append(f"[0:a]volume='{vol_expr}':eval=frame[orig]")

    labels = ["orig"]
    for i, (wav_path, s, d, txt) in enumerate(wavs):
        label = f"w{i}"
        delay_ms = int(s * 1000)
        filtros.append(f"[{i+1}:a]adelay={delay_ms}|{delay_ms}[{label}]")
        labels.append(label)

    n_inputs = len(labels)
    mix = f"[{']['.join(labels)}]amix=inputs={n_inputs}:duration=longest:dropout_transition=0[final]"
    filtros.append(mix)
    filter_complex = ";".join(filtros)

    # 4. Montar comando ffmpeg
    inputs = ["ffmpeg", "-y", "-i", video_path]
    for wav_path, s, d, txt in wavs:
        inputs += ["-i", wav_path]

    out_path = video_path + ".narrado.mp4"
    cmd = inputs + [
        "-filter_complex", filter_complex,
        "-map", "0:v:0",
        "-map", "[final]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ac", "2",
        "-ar", "44100",
        "-shortest",
        out_path,
    ]

    try:
        r = subprocess.run(cmd, capture_output=True, timeout=300)
        for wav_path, s, d, txt in wavs:
            try: os.unlink(wav_path)
            except OSError: pass
        if r.returncode != 0:
            print(f"[TTS] FFmpeg multi-narração falhou (rc={r.returncode}):")
            print(r.stderr.decode("utf-8", errors="replace")[-500:])
            if os.path.exists(out_path):
                try: os.unlink(out_path)
                except OSError: pass
            return []
        os.replace(out_path, video_path)
        return timings
    except Exception as e:
        print(f"[TTS] Erro no multi-mix: {e}")
        for wav_path, s, d, txt in wavs:
            try: os.unlink(wav_path)
            except OSError: pass
        if os.path.exists(out_path):
            try: os.unlink(out_path)
            except OSError: pass
        return []


# ── Processamento ─────────────────────────────────────────────────────────────

def _video_id_from_url(url: str, fallback_idx: int) -> str:
    if "youtube.com/watch?v=" in url:
        return url.split("v=")[-1].split("&")[0]
    if "youtube.com/shorts/" in url:
        return url.split("shorts/")[-1].split("?")[0]
    if "youtu.be/" in url:
        return url.split("youtu.be/")[-1].split("?")[0]
    # Instagram
    for prefix in ("instagram.com/reel/", "instagr.am/reel/", "instagram.com/p/", "instagr.am/p/"):
        if prefix in url:
            return url.split(prefix)[-1].split("?")[0].rstrip("/").split("/")[0]
    return f"video_{int(time.time())}_{fallback_idx}"


async def processar_video(item: dict, clip_index: int, emit) -> str | None:
    """
    Processa um vídeo e chama emit(event_dict) para cada atualização de status.
    emit é uma corrotina async.

    Eventos com cronômetro:
      {type:"started",  idx, at:<epoch_ms>}                 → no início
      {type:"status",   idx, value, at:<epoch_ms>}          → a cada fase
      {type:"progress", idx, phase, fraction:0..1, at}      → granular (download/export)
      {type:"done",     idx, path, started_at, finished_at, elapsed_ms}
      {type:"error",    idx, message, started_at, finished_at, elapsed_ms}
    """
    started_at = int(time.time() * 1000)
    loop = asyncio.get_running_loop()

    async def cb(tipo: str, valor):
        await emit({
            "type":  tipo,
            "idx":   clip_index,
            "value": valor,
            "at":    int(time.time() * 1000),
        })

    def emit_progress_threadsafe(phase: str, fraction: float):
        """Chamada de threads (yt-dlp hook, proglog) — agenda na loop async."""
        asyncio.run_coroutine_threadsafe(
            emit({
                "type":     "progress",
                "idx":      clip_index,
                "phase":    phase,
                "fraction": float(fraction),
                "at":       int(time.time() * 1000),
            }),
            loop,
        )

    # Sinaliza início (frontend usa pra disparar cronômetro)
    await emit({"type": "started", "idx": clip_index, "at": started_at})

    try:
        await cb("status", "baixando")
        # Download com progresso granular
        video_path = await asyncio.to_thread(
            baixar_video,
            item["url"],
            lambda f: emit_progress_threadsafe("baixando", f),
        )

        await cb("status", "exportando")
        os.makedirs(OUTPUT_DIR, exist_ok=True)

        vid_id      = _video_id_from_url(item["url"], clip_index)
        output_path = os.path.join(OUTPUT_DIR, f"{vid_id}.mp4")

        # ── Render título como PNG via MoviePy (1 frame, rápido) ──
        import tempfile as _tf
        title_png = None
        title_text = (item.get("title") or "").strip()
        if title_text:
            titulo_clip = gerar_titulo_clip(
                title_text, 1.0,
                font_label=item.get("font", FONT_DEFAULT),
                title_y=0,
                cor_label=item.get("cor_titulo", COR_TITULO_DEFAULT),
                borda=item.get("titulo_borda", True),
            )
            if titulo_clip:
                fd, title_png = _tf.mkstemp(suffix=".png", prefix="mpy_title_")
                os.close(fd)
                titulo_clip = titulo_clip.with_duration(1)
                await asyncio.to_thread(titulo_clip.save_frame, title_png, t=0)
                titulo_clip.close()

        # ── Render tarja como PNG via MoviePy (1 frame, rápido) ──
        tarja_png = None
        tarja_dict = item.get("tarja")
        if tarja_dict and tarja_dict.get("ativo"):
            tarja_clips = gerar_tarja_clips(tarja_dict, 1.0)
            if tarja_clips:
                tc = CompositeVideoClip(tarja_clips, size=(WIDTH, HEIGHT))
                fd, tarja_png = _tf.mkstemp(suffix=".png", prefix="mpy_tarja_")
                os.close(fd)
                await asyncio.to_thread(tc.save_frame, tarja_png, t=0)
                tc.close()

        # ── Monta comando ffmpeg único ──
        overlay_path_local = OVERLAYS.get(item.get("overlay", "1"))
        video_y = item.get("video_y", VIDEO_Y_DEFAULT)
        scale_w = int(WIDTH * VIDEO_SCALE_RATIO_VERTICAL)
        scale_h = int(HEIGHT * VIDEO_SCALE_RATIO_VERTICAL)
        # y absoluto no canvas: centro do canvas + offset do usuário
        pad_y = (HEIGHT - scale_h) // 2 + video_y
        print(f"[DEBUG] video_y={video_y}, pad_y={pad_y}")

        filtros: list[str] = []
        inputs: list[str] = ["ffmpeg", "-y", "-loglevel", "error", "-i", video_path]
        idx = 1

        # scale → black bg → overlay com video_y (pad filter bugado neste ffmpeg)
        filtros.append(
            f"[0:v]scale='if(gt(iw,ih),{scale_w},-2)':'if(gt(iw,ih),-2,{scale_h})':flags=lanczos[vid];"
            f"color=c=black:s={WIDTH}x{HEIGHT}[bg];"
            f"[bg][vid]overlay=(W-w)/2:{pad_y}:shortest=1[cur]"
        )
        cur = "cur"

        # Filtro de vídeo
        flt = item.get("filtro", FILTRO_DEFAULT)
        if flt == "Preto e Branco":
            filtros.append(f"[{cur}]hue=s=0[vid]")
            cur = "vid"
        elif flt == "Suave":
            filtros.append(f"[{cur}]eq=brightness=0.04:contrast=0.9:gamma=0.92[vid]")
            cur = "vid"

        # Overlay PNG
        if overlay_path_local and os.path.exists(overlay_path_local):
            inputs += ["-loop", "1", "-i", overlay_path_local]
            filtros.append(f"[{cur}][{idx}:v]overlay=0:0[ov]")
            cur = "ov"
            idx += 1

        # Título PNG
        if title_png:
            inputs += ["-loop", "1", "-i", title_png]
            title_y = item.get("title_y", TITLE_Y_DEFAULT)
            filtros.append(f"[{cur}][{idx}:v]overlay=(W-w)/2:{title_y}[t]")
            cur = "t"
            idx += 1

        # Tarja PNG
        if tarja_png:
            inputs += ["-loop", "1", "-i", tarja_png]
            filtros.append(f"[{cur}][{idx}:v]overlay=0:0[final_v]")
            cur = "final_v"
            idx += 1

        if cur != "final_v":
            filtros.append(f"[{cur}]copy[final_v]")
            cur = "final_v"

        cmd = inputs + [
            "-filter_complex", ";".join(filtros),
            "-map", f"[{cur}]", "-map", "0:a?",
            "-c:v", CODEC_VIDEO, *FFMPEG_PARAMS,
            "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
            "-shortest", output_path,
        ]

        r = await asyncio.to_thread(
            lambda: subprocess.run(cmd, capture_output=True, timeout=300)
        )
        if r.returncode != 0:
            err = r.stderr.decode("utf-8", errors="replace")[-500:]
            raise RuntimeError(f"ffmpeg composition falhou (rc={r.returncode}):\n{err}")

        # Limpa PNGs temporários
        for p in [title_png, tarja_png]:
            if p and os.path.exists(p):
                try: os.unlink(p)
                except OSError: pass

        # ── Viral Intro (travar início) ──────────────────────────────
        dur_narracao_intro = 0.0
        ok_viral = False
        if item.get("travar_inicio") and item.get("narrar_titulo"):
            await cb("status", "viral_intro")
            ok_viral, dur_narracao_intro = await asyncio.to_thread(
                _adicionar_intro_viral, output_path, item, video_path,
                overlay_path_local if (overlay_path_local and os.path.exists(overlay_path_local)) else None,
            )
            if not ok_viral:
                print("[viral] intro viral falhou — tentando fallback de narração normal")

        # ── Freeze + narrações em ordem cronológica ────────────────────
        # Processa TODOS os eventos (freeze e narração) em ordem de
        # `start_sec`, ajustando o offset a cada freeze. Assim:
        #   - Um freeze em t=2s acrescenta offset
        #   - Uma narração em t=5s recebe esse offset (já que o freeze
        #     aconteceu antes dela no vídeo original)
        #   - Um freeze em t=8s NÃO afeta a narração em t=5s
        offset_corrente = dur_narracao_intro
        freeze_ids: set[str] = set()
        freeze_legenda_timings: list[tuple[str, float, float]] = []
        narracoes: list[dict] = []
        voice_id = item.get("voice", "padrao")

        # Se narrar_titulo, vira narração normal (se não foi coberta pela intro viral)
        title_text = (item.get("title") or "").strip()
        if title_text and item.get("narrar_titulo") and not ok_viral:
            narracoes.append({
                "id": "titulo",
                "text": title_text,
                "start_sec": float(NARRATION_DELAY_S) + offset_corrente,
                "voice": voice_id,
            })

        # Monta lista única de eventos ordenados por start_sec
        narrations_raw = list(item.get("narrations") or [])
        all_events: list[dict] = []
        for nar in narrations_raw:
            texto = (nar.get("text") or "").strip()
            if not texto:
                continue
            all_events.append({
                "id": nar["id"],
                "text": texto,
                "start_sec": float(nar.get("start_sec", 0)),
                "freeze": nar.get("freeze", False),
                "legenda": nar.get("legenda", False),
            })
        all_events.sort(key=lambda e: e["start_sec"])

        tem_freeze = any(e["freeze"] for e in all_events)
        if tem_freeze:
            await cb("status", "freeze_frames")

        for ev in all_events:
            # Ajusta o tempo: posição no vídeo original + offset acumulado
            # de todos os freezes inseridos ANTES deste evento
            adjusted = ev["start_sec"] + offset_corrente

            if ev["freeze"]:
                wav_freeze = gerar_wav(ev["text"], voice_id)
                if not wav_freeze:
                    continue
                dur_nar = get_audio_duration(wav_freeze)
                if dur_nar <= 0:
                    dur_nar = max(1.5, len(ev["text"]) * 0.08)
                ok, freeze_dur = await asyncio.to_thread(
                    _inserir_freeze_frame_com_narracao, output_path,
                    adjusted, wav_freeze
                )
                if os.path.exists(wav_freeze):
                    try: os.unlink(wav_freeze)
                    except OSError: pass
                if ok:
                    freeze_ids.add(ev["id"])
                    if ev["legenda"]:
                        freeze_legenda_timings.append((
                            ev["text"],
                            adjusted,
                            adjusted + dur_nar,
                        ))
                    offset_corrente += freeze_dur
            else:
                narracoes.append({
                    "id": ev["id"],
                    "text": ev["text"],
                    "start_sec": adjusted,
                    "legenda": ev["legenda"],
                    "voice": voice_id,
                })

        tem_narracoes = bool(narracoes)
        narracao_timings: list[tuple[str, float, float]] = []
        if tem_narracoes:
            await cb("status", "narrando")
            narracao_timings = await asyncio.to_thread(
                _mix_multiplas_narracoes, output_path, narracoes
            )
            if not narracao_timings:
                print("[TTS] mix de narrações falhou — clip mantido sem narração")

        # Concatena timings para legenda personalizada TikTok:
        # freeze narrations + mixadas que têm legenda=true
        legenda_timings_final: list[tuple[str, float, float]] = []
        legenda_timings_final.extend(freeze_legenda_timings)
        for t in narracao_timings:
            txt, start, end = t
            for nar in narracoes:
                if nar.get("text") == txt and nar.get("legenda"):
                    legenda_timings_final.append((txt, start, end))
                    break

        # ── Legenda ────────────────────────────────────────────────
        tem_tiktok = bool(legenda_timings_final)
        precisa_legenda = (
            item.get("gerar_legenda") or
            tem_tiktok
        )

        if precisa_legenda:
            estilo = item.get("estilo_legenda") or "AMARELO_CLASSICO"
            await cb("status", "legendando")

            def _fase(f: str):
                pass

            if tem_tiktok:
                ass_path = _gerar_ass_narracao_tiktok(
                    legenda_timings_final, LEGENDA_FONT_SIZE
                )
                if ass_path:
                    ok_subs = await asyncio.to_thread(
                        subtitles.queimar_legenda, output_path, ass_path
                    )
                    try: os.unlink(ass_path)
                    except OSError: pass
                else:
                    ok_subs = False
            elif narracao_timings:
                ok_subs = await asyncio.to_thread(
                    subtitles.aplicar_legenda_narracao, output_path,
                    narracao_timings, estilo, _fase
                )
            else:
                ok_subs = await asyncio.to_thread(
                    subtitles.aplicar_legenda, output_path, estilo, _fase
                )
            if not ok_subs:
                print("[subs] legenda falhou — clip mantido sem legenda")

        finished_at = int(time.time() * 1000)
        await cb("status", "concluido")
        await emit({
            "type":        "done",
            "idx":         clip_index,
            "path":        output_path,
            "started_at":  started_at,
            "finished_at": finished_at,
            "elapsed_ms":  finished_at - started_at,
        })
        return output_path

    except Exception as e:
        import traceback
        traceback.print_exc()
        finished_at = int(time.time() * 1000)
        await cb("status", "erro")
        await emit({
            "type":        "error",
            "idx":         clip_index,
            "message":     str(e),
            "started_at":  started_at,
            "finished_at": finished_at,
            "elapsed_ms":  finished_at - started_at,
        })
        return None
