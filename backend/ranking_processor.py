"""
backend/ranking_processor.py — Pipeline da aba "Ranking" (Top N).

Reaproveita ao máximo video_processor.py, subtitles.py, narration.py e
drive_uploader.py. As funções aqui apenas orquestram e adicionam o que é
específico de ranking: download de trecho, badge de número, transições,
concatenação em passos e normalização de loudness.
"""
from __future__ import annotations

import os
import time
import json
import tempfile
import shutil
import subprocess
import asyncio

from config import (
    WIDTH, HEIGHT, VIDEO_SCALE_RATIO_VERTICAL, VIDEO_SCALE_RATIO_HORIZONTAL, VIDEO_Y_DEFAULT,
    FONT_DEFAULT, COR_TITULO_DEFAULT, FILTRO_DEFAULT, TITLE_Y_DEFAULT,
    OVERLAYS, TITLE_FONT_SIZE,
    RANKING_DURACAO_FIXA_DEFAULT, RANKING_DURACAO_TOPO_PROP,
    RANKING_DURACAO_BASE_PROP, RANKING_TRANSICAO_DUR_S,
    RANKING_BADGE_FONT_SIZE, RANKING_BADGE_COR,
    RANKING_BADGE_TOP_FRAC, RANKING_TARGET_LUFS, RANKING_FPS,
    OUTPUT_DIR, DOWNLOAD_DIR, SFX_DIR, MUSIC_DIR,
    RANKING_OUTRO_DEFAULT_TEXTO,
)
from video_processor import (
    GPU_AVAILABLE, CODEC_VIDEO, FFMPEG_PARAMS,
    baixar_video, extrair_frame, gerar_titulo_clip,
    _get_video_duration, _video_id_from_url,
    _adicionar_hook, _adicionar_trilha_fundo,
)
import subtitles
import narration
import drive_uploader


# ── Helpers de Paths ───────────────────────────────────────────────────────────

_RANK_TMP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ranking_tmp")

def _rank_tmp_dir() -> str:
    os.makedirs(_RANK_TMP, exist_ok=True)
    return _RANK_TMP


def _run(cmd: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


# ── 1. Download de trecho ──────────────────────────────────────────────────────

def baixar_trecho(link: str, inicio_s: float, fim_s: float) -> str | None:
    """
    Baixa SÓ o trecho [inicio_s, fim_s] do vídeo.
    Estratégia:
      1) yt-dlp download_ranges (corta na origem, mais rápido);
      2) fallback: baixa o vídeo inteiro e recorta localmente com ffmpeg.
    Retorna o path do .mp4 do trecho ou None.
    """
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    vid_id = _video_id_from_url(link, int(time.time()))
    out_path = os.path.join(DOWNLOAD_DIR, f"rk_{vid_id}_{int(inicio_s)}_{int(fim_s)}.mp4")
    if os.path.exists(out_path):
        return out_path

    # Tenta corte na origem
    try:
        from yt_dlp.utils import download_range_func
        ydl_opts = {
            "outtmpl": out_path,
            "format": "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/best",
            "merge_output_format": "mp4",
            "quiet": True, "no_warnings": True,
            "force_keyframes_at_cuts": True,
            "download_ranges": download_range_func(None, [(inicio_s, fim_s)]),
        }
        if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cookies.txt")):
            ydl_opts["cookiefile"] = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "cookies.txt")
        import yt_dlp
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(link, download=True)
        if os.path.exists(out_path) and os.path.getsize(out_path) > 1000:
            return out_path
    except Exception as e:
        print(f"[ranking] corte na origem falhou ({e}) — baixando completo")

    # Fallback: download completo + recorte local
    try:
        full = baixar_video(link)
        if not full or not os.path.exists(full):
            return None
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{inicio_s:.2f}", "-to", f"{fim_s:.2f}",
            "-i", full,
            "-c:v", CODEC_VIDEO, *FFMPEG_PARAMS,
            "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
            out_path,
        ]
        r = _run(cmd, timeout=300)
        try:
            os.unlink(full)
        except OSError:
            pass
        if r.returncode == 0 and os.path.exists(out_path):
            return out_path
        print(f"[ranking] recorte local falhou (rc={r.returncode}): {r.stderr.decode('utf-8','replace')[-300:]}")
        return None
    except Exception as e:
        print(f"[ranking] baixar_trecho erro: {e}")
        return None


def gerar_thumb(link: str, t: float = 3.0) -> str | None:
    """Frame de preview do vídeo de origem (reaproveita extrair_frame)."""
    fd, out = tempfile.mkstemp(suffix=".jpg", prefix="rk_thumb_", dir=_rank_tmp_dir())
    os.close(fd)
    if extrair_frame(link, out, t):
        return out
    try:
        os.unlink(out)
    except OSError:
        pass
    return None


# ── 2. Badge de número ──────────────────────────────────────────────────────────

def _render_side_list_png(ranking: dict, current_posicao: int) -> str | None:
    """
    Gera um PNG (1080x1920 transparente) contendo a lista lateral de itens.
    A ordem cronológica em que os itens aparecem no vídeo define o que é exibido.
    """
    try:
        import tempfile
        from PIL import Image, ImageDraw, ImageFont
        from config import FONT_DEFAULT, font_path
        
        fd, path = tempfile.mkstemp(suffix=".png", prefix="rk_sidelist_", dir=_rank_tmp_dir())
        os.close(fd)
        
        ordem = ranking.get("ordem", "decrescente")
        itens_cronologicos = sorted(ranking.get("itens", []), key=lambda x: x.get("posicao", 0), reverse=(ordem == "decrescente"))
        
        # Encontra o índice cronológico do item atual
        idx_current = 0
        for i, it in enumerate(itens_cronologicos):
            if it.get("posicao") == current_posicao:
                idx_current = i
                break
                
        # A lista visual DEVE ser sempre 1 no topo, N em baixo
        itens_visuais = sorted(ranking.get("itens", []), key=lambda x: x.get("posicao", 0))
        
        # Medidas equivalentes ao frontend:
        y_offset = int(ranking.get("itens_y", 538))
        x_offset = 65
        line_height = 70
        
        font_file = font_path(ranking.get("font", FONT_DEFAULT))
        try:
            font = ImageFont.truetype(font_file, 50)
        except Exception:
            font = ImageFont.load_default()
            
        img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        for it in itens_visuais:
            pos = it.get("posicao")
            
            # Qual é o índice cronológico deste item (it) na linha do tempo?
            idx_this = 0
            for i, c_it in enumerate(itens_cronologicos):
                if c_it.get("posicao") == pos:
                    idx_this = i
                    break
                    
            # Oculta títulos futuros (itens que aparecem cronologicamente depois do atual)
            if idx_this > idx_current:
                titulo = ""
            else:
                titulo = it.get("titulo_item") or f"Item {pos}"
                
            num_text = f"{pos}º"
            
            # Destaque visual apenas no título: VERDE para o item atual, AMARELO para os passados
            is_current = (pos == current_posicao)
            title_color = "#00FF66" if is_current else "#FFD400"
            
            # 1. Desenha o número (sempre branco)
            draw.text((x_offset, y_offset), num_text, font=font, fill="white", 
                      stroke_width=3, stroke_fill="black")
            
            # 2. Desenha o título do lado
            if titulo:
                num_width = draw.textlength(num_text + " ", font=font)
                draw.text((x_offset + num_width, y_offset), titulo, font=font, fill=title_color, 
                          stroke_width=3, stroke_fill="black")
            
            y_offset += line_height
            
        img.save(path, "PNG")
        return path if os.path.exists(path) else None
    except Exception as e:
        print(f"[ranking] sidelist falhou: {e}")
        return None


# ── 3. Montar um item ──────────────────────────────────────────────────────────

def _render_title_png(ranking: dict, item: dict) -> str | None:
    text = (ranking.get("titulo_geral") or "").strip()
    if not text:
        return None
    try:
        fd, path = tempfile.mkstemp(suffix=".png", prefix="rk_title_", dir=_rank_tmp_dir())
        os.close(fd)
        clip = gerar_titulo_clip(
            text, 1.0,
            font_label=ranking.get("font", FONT_DEFAULT),
            title_y=0,
            cor_label=ranking.get("cor_titulo", COR_TITULO_DEFAULT),
            borda=ranking.get("titulo_borda", True),
            font_size=85,
        )
        if not clip:
            return None
        clip.save_frame(path, t=0)
        clip.close()
        return path if os.path.exists(path) else None
    except Exception as e:
        print(f"[ranking] title png falhou: {e}")
        return None


def montar_item(ranking: dict, item: dict, posicao: int, idx: int, emit) -> str | None:
    """
    Baixa o trecho e renderiza 1 item vertical (9:16) com filtro, overlay global,
    lista lateral e título do item. Normaliza o áudio.
    Retorna o path do .mp4 do item ou None.
    """
    link = (item.get("link") or "").strip()
    if not link:
        return None

    inicio = float(item.get("trim_inicio_s") or item.get("inicio") or 0)
    fim = float(item.get("trim_fim_s") or item.get("fim") or 0)
    if fim <= inicio:
        fim = inicio + 10.0

    try:
        if emit:
            asyncio.get_event_loop().run_until_complete if False else None
    except Exception:
        pass

    # Download do trecho
    raw = baixar_trecho(link, inicio, fim)
    if not raw:
        return None

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    vid_id = _video_id_from_url(link, idx)
    out_path = os.path.join(OUTPUT_DIR, f"rk_item_{idx}_{vid_id}.mp4")

    # PNGeis (lista lateral + título)
    sidelist_png = _render_side_list_png(ranking, posicao)
    title_png = _render_title_png(ranking, item)
    # ── Render tarja como PNG via MoviePy (1 frame, rápido) ──
    tarja_png = None
    tarja_dict = item.get("tarja")
    if tarja_dict and tarja_dict.get("ativo"):
        from moviepy import CompositeVideoClip
        from video_processor import gerar_tarja_clips
        tarja_clips = gerar_tarja_clips(tarja_dict, 1.0)
        if tarja_clips:
            tc = CompositeVideoClip(tarja_clips, size=(WIDTH, HEIGHT))
            fd, tarja_png = tempfile.mkstemp(suffix=".png", prefix="mpy_tarja_")
            os.close(fd)
            tc.save_frame(tarja_png, t=0)
            tc.close()

    overlay_path_local = OVERLAYS.get(ranking.get("overlay", "1")) if ranking.get("overlay") else None
    video_y = int(item.get("video_y", VIDEO_Y_DEFAULT))
    scale_w = int(WIDTH * VIDEO_SCALE_RATIO_HORIZONTAL)
    scale_h = int(HEIGHT * VIDEO_SCALE_RATIO_VERTICAL)
    pad_y = (HEIGHT - scale_h) // 2 + video_y

    filtros: list[str] = []
    inputs: list[str] = ["ffmpeg", "-y", "-loglevel", "error", "-i", raw]
    i = 1

    filtros.append(
        f"[0:v]scale='if(gt(iw,ih),{scale_w},-2)':'if(gt(iw,ih),-2,{scale_h})':flags=lanczos[vid];"
        f"color=c=black:s={WIDTH}x{HEIGHT}[bg];"
        f"[bg][vid]overlay=(W-w)/2:(H-h)/2+{video_y}:shortest=1[cur]"
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

    # ── Apply Tarja overlay (above video, below overlay mask) ──
    if tarja_png and os.path.exists(tarja_png):
        inputs += ["-loop", "1", "-i", tarja_png]
        filtros.append(f"[{cur}][{i}:v]overlay=0:0[tarj]")
        cur = "tarj"
        i += 1

    if overlay_path_local and os.path.exists(overlay_path_local):
        inputs += ["-loop", "1", "-i", overlay_path_local]
        filtros.append(f"[{cur}][{i}:v]overlay=0:0[ov]")
        cur = "ov"
        i += 1

    if sidelist_png:
        # A lista lateral já é do tamanho do vídeo (WIDTHxHEIGHT) e com fundo transparente.
        inputs += ["-loop", "1", "-i", sidelist_png]
        filtros.append(f"[{cur}][{i}:v]overlay=0:0[bd]")
        cur = "bd"
        i += 1

    if title_png:
        inputs += ["-loop", "1", "-i", title_png]
        title_y = int(ranking.get("title_y", TITLE_Y_DEFAULT))
        filtros.append(f"[{cur}][{i}:v]overlay=(W-w)/2:{title_y}[t]")
        cur = "t"
        i += 1

    if cur != "final_v":
        filtros.append(f"[{cur}]copy[final_v]")
        cur = "final_v"

    # Áudio original do item (muta se trilha_modo for 100_musica)
    trilha_modo = ranking.get("trilha_modo", "50_50")
    vol_base = 0.0 if trilha_modo == "100_musica" else 1.0

    # Narração do item
    narracao_wav = None
    if ranking.get("narrar_titulos_itens"):
        from narration import gerar_wav
        texto = item.get("titulo_item") or f"Item {posicao}"
        voice = item.get("voice") or ranking.get("voice", "padrao")
        try:
            narracao_wav = gerar_wav(texto, voice)
        except Exception as e:
            print(f"[ranking] Erro gerando narração do item {posicao}: {e}")

    # Efeito sonoro na introdução do item (transicao_sfx)
    sfx_path = None
    transicao_sfx = ranking.get("transicao_sfx", "none")
    if transicao_sfx and transicao_sfx != "none":
        for ext in [".mp3", ".wav", ".MP3", ".WAV"]:
            cand = os.path.join(SFX_DIR, f"{transicao_sfx}{ext}")
            if os.path.exists(cand):
                sfx_path = cand
                break

    # Monta grafo de áudio
    extra_audios = []
    dur_nar_item = 0.0
    if narracao_wav and os.path.exists(narracao_wav):
        inputs += ["-i", narracao_wav]
        try:
            from narration import get_audio_duration
            dur_nar_item = get_audio_duration(narracao_wav)
        except Exception:
            dur_nar_item = 2.5
        filtros.append(f"[{i}:a]volume=1.8[a_nar]")
        extra_audios.append("a_nar")
        i += 1

    if sfx_path:
        inputs += ["-i", sfx_path]
        vol_sfx = 2.5 if transicao_sfx == "whoosh" else 2.0
        filtros.append(f"[{i}:a]volume={vol_sfx}[a_sfx]")
        extra_audios.append("a_sfx")
        i += 1

    a_map = "0:a?"
    if trilha_modo == "100_musica":
        inputs += ["-f", "lavfi", "-t", "300", "-i", "anullsrc=r=44100:cl=stereo"]
        silent_idx = i
        i += 1
        if extra_audios:
            mix_inputs = [f"{silent_idx}:a"] + extra_audios
            n_mix = len(mix_inputs)
            mix_str = "".join(f"[{label}]" for label in mix_inputs)
            filtros.append(f"{mix_str}amix=inputs={n_mix}:duration=first:dropout_transition=0:normalize=0[aout]")
            a_map = "[aout]"
        else:
            a_map = f"{silent_idx}:a"
    elif extra_audios:
        if dur_nar_item > 0:
            filtros.append(f"[0:a]volume='if(between(t,0,{dur_nar_item+0.25}),0.2,1)':eval=frame[base_a]")
        else:
            filtros.append(f"[0:a]volume={vol_base}[base_a]")
        mix_inputs = ["base_a"] + extra_audios
        n_mix = len(mix_inputs)
        mix_str = "".join(f"[{label}]" for label in mix_inputs)
        filtros.append(f"{mix_str}amix=inputs={n_mix}:duration=first:dropout_transition=0:normalize=0[aout]")
        a_map = "[aout]"
    elif vol_base != 1.0:
        filtros.append(f"[0:a]volume={vol_base}[aout]")
        a_map = "[aout]"

    cmd = inputs + [
        "-filter_complex", ";".join(filtros),
        "-map", f"[{cur}]", "-map", a_map,
        "-c:v", CODEC_VIDEO, *FFMPEG_PARAMS,
        "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
        "-shortest", out_path,
    ]
    r = _run(cmd, timeout=300)
    for p in [sidelist_png, title_png, tarja_png, narracao_wav]:
        if p and os.path.exists(p):
            try: os.unlink(p)
            except OSError:
                pass
    if r.returncode != 0:
        print(f"[ranking] compose item {idx} falhou: {r.stderr.decode('utf-8','replace')[-400:]}")
        try: os.unlink(raw)
        except OSError: pass
        return None

    try: os.unlink(raw)
    except OSError: pass

    # Narração do item (opcional)
    texto = (item.get("narracao_texto") or "").strip()
    if texto:
        wav = narration.gerar_wav(texto, item.get("voice", "padrao"))
        if wav:
            _mix_narracao_simples(out_path, wav)
            try: os.unlink(wav)
            except OSError: pass

    # Normaliza loudness
    norm = normalizar_audio(out_path)
    if norm and os.path.exists(norm):
        os.replace(norm, out_path)

    return out_path


def _mix_narracao_simples(video_path: str, wav_path: str) -> bool:
    """Mixa uma narração por cima do item abaixando o som original EXATAMENTE na hora da narração."""
    from video_processor import NARRATION_DUCK_VOLUME
    from narration import get_audio_duration
    dur_nar = get_audio_duration(wav_path)
    if dur_nar <= 0:
        dur_nar = 2.5
    t_start = 0.2
    t_end = round(0.3 + dur_nar + 0.15, 2)
    out = video_path + ".narr.mp4"
    fc = (
        f"[0:a]volume='if(between(t,{t_start},{t_end}),{NARRATION_DUCK_VOLUME},1)':eval=frame[orig];"
        f"[1:a]adelay=300|300,volume=1.8[nar];"
        f"[orig][nar]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[final]"
    )
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", video_path, "-i", wav_path,
        "-filter_complex", fc,
        "-map", "0:v:0", "-map", "[final]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
        out,
    ]
    r = _run(cmd, timeout=120)
    if r.returncode == 0 and os.path.exists(out):
        os.replace(out, video_path)
        return True
    return False


# ── 4. Transições ───────────────────────────────────────────────────────────────

def _gerar_clipe_transicao(tipo: str, dur_s: float, seed_path: str | None = None) -> str | None:
    """Gera um clipe de transição curto (mp4) do tipo solicitado."""
    fd, out = tempfile.mkstemp(suffix=".mp4", prefix="rk_trans_", dir=_rank_tmp_dir())
    os.close(fd)
    if tipo == "nenhum":
        return None
    fps = RANKING_FPS
    frames = max(2, int(dur_s * fps))
    try:
        if tipo == "flash":
            # Pisca preto muito rápido (Fade Out/In black)
            vf = f"color=c=black:s={WIDTH}x{HEIGHT}:r={fps},fade=t=in:st=0:d={dur_s/2},fade=t=out:st={dur_s/2}:d={dur_s/2}"
        elif tipo == "zoom_corte":
            vf = (f"color=c=black:s={WIDTH}x{HEIGHT}:r={fps},"
                  f"zoompan=z='min(zoom+0.1,2)':d={frames}:s={WIDTH}x{HEIGHT},"
                  f"fade=t=in:st=0:d=0.05")
        elif tipo == "glitch":
            vf = (f"color=c=black:s={WIDTH}x{HEIGHT}:r={fps},"
                  f"format=gray,noise=alls=40:allf=t+u,eq=contrast=1.4:brightness=0.1")
        else:
            vf = f"color=c=white:s={WIDTH}x{HEIGHT}:r={fps}"
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", vf,
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", f"{dur_s:.2f}",
            "-c:v", CODEC_VIDEO, *FFMPEG_PARAMS,
            "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
            out,
        ]
        r = _run(cmd, timeout=60)
        if r.returncode == 0 and os.path.exists(out):
            return out
        return None
    except Exception as e:
        print(f"[ranking] transição falhou: {e}")
        return None


def aplicar_transicao(clip_a: str, clip_b: str, tipo: str, sfx_path: str | None) -> str | None:
    """
    Concatena clip_a + transição + clip_b. Se houver SFX, mixa no ponto de
    junção (início da transição).
    """
    trans = _gerar_clipe_transicao(tipo, RANKING_TRANSICAO_DUR_S)
    if not trans:
        # Sem transição: concatena direto
        return concatenar_simples([clip_a, clip_b])
    fd, out = tempfile.mkstemp(suffix=".mp4", prefix="rk_join_", dir=_rank_tmp_dir())
    os.close(fd)

    parts = [clip_a, trans, clip_b]
    list_file = os.path.join(_rank_tmp_dir(), "rk_concat_list.txt")
    with open(list_file, "w", encoding="utf-8") as f:
        for p in parts:
            f.write(f"file '{p.replace(chr(92), '/')}'\n")

    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", list_file,
        "-c:v", CODEC_VIDEO, *FFMPEG_PARAMS,
        "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
        out,
    ]
    r = _run(cmd, timeout=300)
    if r.returncode != 0:
        print(f"[ranking] join falhou: {r.stderr.decode('utf-8','replace')[-300:]}")
        try: os.unlink(out)
        except OSError: pass
        return concatenar_simples([clip_a, clip_b])
    return out


def concatenar_simples(paths: list[str]) -> str | None:
    fd, out = tempfile.mkstemp(suffix=".mp4", prefix="rk_cat_", dir=_rank_tmp_dir())
    os.close(fd)
    list_file = os.path.join(_rank_tmp_dir(), "rk_cat_list.txt")
    with open(list_file, "w", encoding="utf-8") as f:
        for p in paths:
            if p and os.path.exists(p):
                f.write(f"file '{p.replace(chr(92), '/')}'\n")
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", list_file,
        "-c:v", CODEC_VIDEO, *FFMPEG_PARAMS,
        "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
        out,
    ]
    r = _run(cmd, timeout=400)
    if r.returncode == 0 and os.path.exists(out):
        return out
    return None


def _mixar_sfx_em_ponto(video_path: str, sfx_path: str, timestamp_s: float) -> str:
    """Mixa um efeito sonoro no vídeo em um timestamp específico (em segundos)."""
    if not sfx_path or not os.path.exists(sfx_path):
        return video_path
    delay_ms = max(0, int(timestamp_s * 1000))
    fd, out = tempfile.mkstemp(suffix=".mp4", prefix="rk_sfx_", dir=_rank_tmp_dir())
    os.close(fd)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", video_path, "-i", sfx_path,
        "-filter_complex",
        f"[1:a]adelay={delay_ms}|{delay_ms},volume=2.2[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]",
        "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
        out,
    ]
    r = _run(cmd, timeout=120)
    if r.returncode == 0 and os.path.exists(out):
        try: os.unlink(video_path)
        except OSError: pass
        return out
    if os.path.exists(out):
        try: os.unlink(out)
        except OSError: pass
    return video_path


def concatenar_ranking(item_paths: list[str], transicao_tipo: str, sfx_path: str | None) -> str | None:
    """Concatena os itens inserindo transições e mixando o efeito sonoro na troca entre cada par."""
    if not item_paths:
        return None
    if len(item_paths) == 1:
        return item_paths[0]
    result = item_paths[0]
    for nxt in item_paths[1:]:
        dur_before = _get_video_duration(result) or 0.0
        joined = aplicar_transicao(result, nxt, transicao_tipo, sfx_path)
        if not joined:
            return None
        if sfx_path and os.path.exists(sfx_path):
            joined = _mixar_sfx_em_ponto(joined, sfx_path, dur_before)
        result = joined
    return result


# ── 5. Normalização de loudness ─────────────────────────────────────────────────

def normalizar_audio(path: str) -> str | None:
    """Normaliza loudness via ffmpeg loudnorm (2 passes). Retorna novo path."""
    fd, out = tempfile.mkstemp(suffix=".mp4", prefix="rk_norm_", dir=_rank_tmp_dir())
    os.close(fd)

    # Pass 1: medir
    p1 = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", path,
        "-af", f"loudnorm=I={RANKING_TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json",
        "-f", "null", "-",
    ]
    r1 = _run(p1, timeout=120)
    measured = {}
    try:
        txt = r1.stderr.decode("utf-8", errors="replace")
        start = txt.find("{")
        end = txt.rfind("}") + 1
        if start >= 0 and end > start:
            measured = json.loads(txt[start:end])
    except Exception:
        measured = {}

    mi = measured.get("input_i", RANKING_TARGET_LUFS)
    mtp = measured.get("input_tp", -1.5)
    mlra = measured.get("input_lra", 11.0)
    mthr = measured.get("input_thresh", -20.0)
    off = measured.get("target_offset", 0.0)

    af = (
        f"loudnorm=I={RANKING_TARGET_LUFS}:TP=-1.5:LRA=11:"
        f"measured_I={mi}:measured_TP={mtp}:measured_LRA={mlra}:"
        f"measured_thresh={mthr}:offset={off}:linear=true"
    )
    p2 = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", path,
        "-af", af,
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
        out,
    ]
    r2 = _run(p2, timeout=180)
    if r2.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 1000:
        return out
    try: os.unlink(out)
    except OSError: pass
    return None


# ── 6. Outro / CTA final ────────────────────────────────────────────────────────

def _adicionar_outro(video_path: str, texto: str) -> bool:
    """
    Anexa um CTA final (textão estático ~3s) ao final do vídeo.
    Reaproveita a lógica visual do hook mas concatena DEPOIS.
    """
    import shutil as _sh
    tmpdir = tempfile.mkdtemp(prefix="rk_outro_", dir=_rank_tmp_dir())
    try:
        frame_path = os.path.join(tmpdir, "frame.jpg")
        # usa o último frame do vídeo como fundo (blur leve)
        r = _run([
            "ffmpeg", "-y", "-loglevel", "error",
            "-s", f"{RANKING_FPS}", "-i", video_path,
            "-vf", "select=eq(n\,0),scale=-2:720", "-frames:v", "1", frame_path,
        ], timeout=30)
        # fallback: blur do primeiro frame
        if r.returncode != 0 or not os.path.exists(frame_path):
            r = _run([
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", video_path, "-frames:v", "1", "-q:v", "3", frame_path,
            ], timeout=30)

        dur = 3.0
        fps = RANKING_FPS
        bg = frame_path
        if not os.path.exists(bg):
            bg = frame_path
        outro_path = os.path.join(tmpdir, "outro.mp4")

        from moviepy import TextClip
        from config import font_path
        
        fd, txt_png = tempfile.mkstemp(suffix=".png", prefix="rk_outro_", dir=tmpdir)
        os.close(fd)
        tc = (TextClip(text=texto, font=font_path("Padrão"),
                       font_size=80, color="#FFFFFF", stroke_color="black",
                       stroke_width=6, size=(int(WIDTH*0.9), None),
                       method="caption", text_align="center").with_duration(1))
        tc.save_frame(txt_png, t=0)
        tc.close()

        vf = (f"loop=1:size={WIDTH}x{HEIGHT}:rate={fps}:file='{bg.replace(chr(92),'/')}',"
              f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},"
              f"boxblur=lr=8:lp=2[bg];"
              f"movie='{txt_png.replace(chr(92),'/')}'[txt];"
              f"[bg][txt]overlay=(W-w)/2:(H-h)/2[outv]")
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono",
            "-filter_complex", vf,
            "-t", f"{dur:.2f}",
            "-c:v", CODEC_VIDEO, *FFMPEG_PARAMS,
            outro_path,
        ]
        r2 = _run(cmd, timeout=60)
        if r2.returncode != 0 or not os.path.exists(outro_path):
            return False

        # concatena depois
        out_path = video_path + ".outro.mp4"
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", video_path, "-i", outro_path,
            "-filter_complex", "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]",
            "-map", "[outv]", "-map", "[outa]",
            "-c:v", CODEC_VIDEO, *FFMPEG_PARAMS,
            "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
            out_path,
        ]
        r3 = _run(cmd, timeout=120)
        if r3.returncode != 0:
            return False
        os.replace(out_path, video_path)
        return True
    except Exception as e:
        print(f"[ranking] outro falhou: {e}")
        return False
    finally:
        _sh.rmtree(tmpdir, ignore_errors=True)


# ── 7. Montar ranking completo ──────────────────────────────────────────────────

def montar_ranking(ranking: dict, emit) -> str | None:
    """
    Orquestra o pipeline de um ranking:
      1) monta cada item (download trecho → vertical → badge/título → narração → normalize)
      2) concatena com transições
      3) hook de intro (título geral)
      4) outro/CTA final
      5) trilha de fundo (duck)
      6) legenda automática (whisper)
      7) export final
    Retorna o path do clip final ou None.
    `emit` é uma função sync (não-async) que recebe dict de evento.
    """
    itens = list(ranking.get("itens", []))
    if not itens:
        return None

    # Ordena por posição final respeitando a ordem
    ordem = ranking.get("ordem", "decrescente")
    itens_ordenados = sorted(itens, key=lambda x: x.get("posicao", 0), reverse=(ordem == "decrescente"))

    item_paths: list[str] = []
    for i, item in enumerate(itens_ordenados):
        try:
            emit({"type": "item_iniciado", "posicao": item.get("posicao"), "idx": i})
            p = montar_item(ranking, item, item.get("posicao", i + 1), i, emit)
            if not p:
                emit({"type": "item_erro", "posicao": item.get("posicao"),
                      "message": "falha ao montar item (link inválido?)"})
                return None
            item_paths.append(p)
            emit({"type": "item_concluido", "posicao": item.get("posicao"), "path": p})
        except Exception as e:
            emit({"type": "item_erro", "posicao": item.get("posicao"), "message": str(e)})
            return None

    emit({"type": "status", "value": "concatenando"})
    sfx_file = None
    transicao_sfx = ranking.get("transicao_sfx", "none")
    if transicao_sfx and transicao_sfx != "none":
        for ext in [".mp3", ".wav", ".MP3", ".WAV"]:
            cand = os.path.join(SFX_DIR, f"{transicao_sfx}{ext}")
            if os.path.exists(cand):
                sfx_file = cand
                break
    final = concatenar_ranking(item_paths, ranking.get("transicao_tipo", "flash"), sfx_file)
    if not final:
        return None

    # Hook de intro (título geral)
    hook = ranking.get("hook")
    if hook and hook.get("ativo"):
        try:
            item_like = {
                "title": ranking.get("titulo_geral", ""),
                "hook_tipo": hook.get("tipo", "textao"),
                "hook_texto": hook.get("texto", ""),
                "hook_som_entrada": hook.get("som_entrada", "notificacao"),
                "hook_som_saida": hook.get("som_saida", "whoosh"),
                "voice": "padrao",
            }
            ok, _ = _adicionar_hook(final, item_like, None, None)
            if not ok:
                print("[ranking] hook falhou — continuando")
        except Exception as e:
            print(f"[ranking] hook erro: {e}")

    # Narração do título geral
    if ranking.get("narrar_titulo_geral") and ranking.get("titulo_geral"):
        try:
            wav = narration.gerar_wav(ranking["titulo_geral"], "padrao")
            if wav:
                _mix_narracao_simples(final, wav)
                try: os.unlink(wav)
                except OSError: pass
        except Exception as e:
            print(f"[ranking] narracao titulo erro: {e}")

    # Outro / CTA
    outro = ranking.get("outro")
    if outro and outro.get("estilo") not in (None, "none"):
        try:
            _adicionar_outro(final, outro.get("texto", RANKING_OUTRO_DEFAULT_TEXTO))
        except Exception as e:
            print(f"[ranking] outro erro: {e}")

    # Trilha de fundo
    musica = ranking.get("trilha_fundo")
    if musica and musica != "none":
        try:
            _adicionar_trilha_fundo(final, musica, ranking.get("trilha_modo", "50_50"))
        except Exception as e:
            print(f"[ranking] trilha erro: {e}")

    # Legenda automática (sobre o vídeo final consolidado)
    legenda = ranking.get("legenda") or {}
    if legenda.get("ativa"):
        try:
            estilo = legenda.get("estilo", "AMARELO_CLASSICO")
            emit({"type": "status", "value": "legendando"})
            ok = subtitles.aplicar_legenda(final, estilo)
            if not ok:
                print("[ranking] legenda falhou")
        except Exception as e:
            print(f"[ranking] legenda erro: {e}")

    # CTA Outro Final ('já segue nois ai' + Plinnnn)
    try:
        from video_processor import adicionar_cta_final_audio
        adicionar_cta_final_audio(final)
    except Exception as e:
        print(f"[ranking] CTA final erro: {e}")

    # Normalização final de loudness
    try:
        norm = normalizar_audio(final)
        if norm and os.path.exists(norm):
            os.replace(norm, final)
    except Exception as e:
        print(f"[ranking] normalização final falhou: {e}")

    return final
