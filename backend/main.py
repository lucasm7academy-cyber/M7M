from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any

# Console UTF-8 no Windows (evita UnicodeEncodeError em prints com emoji)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from fastapi import FastAPI, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import (
    OUTPUT_DIR, DOWNLOAD_DIR, OVERLAYS, TITULOS_PADRAO, ROOT, overlay_path,
    FONTS, FONT_DEFAULT, FILTROS, FILTRO_DEFAULT,
    TITLE_Y_DEFAULT, TITLE_Y_MIN, TITLE_Y_MAX,
    VIDEO_Y_DEFAULT, VIDEO_Y_MIN, VIDEO_Y_MAX,
    CORES_TITULO, COR_TITULO_DEFAULT,
    FRAMES_DIR, TARJA_DEFAULT, SFX_DIR, MUSIC_DIR,
    HOOK_TIPOS, HOOK_TIPO_DEFAULT, HOOK_SOM_OPCOES, HOOK_SOM_ENTRADA_DEFAULT,
    HOOK_SOM_SAIDA_DEFAULT, HOOK_TEXT_DEFAULT, HOOK_DURATION_S,
)
from video_processor import GPU_AVAILABLE, CODEC_VIDEO, processar_video, proximo_titulo, extrair_frame, obter_duracao
from viral_fetcher import buscar_videos_virais
import drive_uploader
import pastas
import ranking_processor as ranking_p
from config import (
    RANKING_QUANTIDADES, RANKING_ORDEM_DEFAULT, RANKING_DURACAO_FIXA_DEFAULT,
    RANKING_TRANSICAO_DEFAULT, RANKING_OUTRO_DEFAULT_TEXTO, RANKING_OUTRO_DEFAULT,
)

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Video Editor API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(OUTPUT_DIR,   exist_ok=True)
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(FRAMES_DIR,   exist_ok=True)


def _extrair_video_id(url: str) -> str | None:
    """Extrai o video_id do URL (YouTube, Instagram)."""
    if not url:
        return None
    # YouTube
    if "shorts/" in url:
        return url.split("shorts/")[-1].split("?")[0].split("&")[0]
    if "v=" in url:
        return url.split("v=")[-1].split("&")[0]
    if "youtu.be/" in url:
        return url.split("youtu.be/")[-1].split("?")[0]
    # Instagram
    if "/reel/" in url:
        return url.split("/reel/")[-1].split("/")[0].split("?")[0].split("&")[0]
    if "/p/" in url:
        return url.split("/p/")[-1].split("/")[0].split("?")[0].split("&")[0]
    return None


def _cleanup_local(clip_path: str | None, url: str | None) -> list[str]:
    """
    Apaga o clip final (clips/) E o cru (downloads/<id>.mp4) após upload OK.
    Devolve lista de paths removidos.
    """
    removidos = []
    if clip_path and os.path.exists(clip_path):
        try:
            os.remove(clip_path)
            removidos.append(clip_path)
        except OSError as e:
            print(f"[cleanup] falha apagando clip {clip_path}: {e}")

    vid_id = _extrair_video_id(url or "")
    if vid_id:
        cru = os.path.join(DOWNLOAD_DIR, f"{vid_id}.mp4")
        if os.path.exists(cru):
            try:
                os.remove(cru)
                removidos.append(cru)
            except OSError as e:
                print(f"[cleanup] falha apagando cru {cru}: {e}")
    return removidos

# ── Estado em memória ─────────────────────────────────────────────────────────

lista_videos: list[dict] = []
_queue_worker_task: asyncio.Task | None = None
_processing = False  # mantido para compatibilidade

# Ranking (Top N) — fila dedicada
lista_rankings: list[dict] = []
_ranking_worker_task: asyncio.Task | None = None

# ── WebSocket manager ─────────────────────────────────────────────────────────

class WSManager:
    def __init__(self):
        self.connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket):
        self.connections.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.connections:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.connections.remove(ws)


manager = WSManager()


def criar_emit_para(item: dict):
    """Cria uma emit wrapper que injeta 'id' do vídeo e resolve 'idx' dinâmico."""
    async def emit(event: dict):
        event["id"] = item.get("id", "")
        try:
            event["idx"] = lista_videos.index(item)
        except ValueError:
            event["idx"] = -1
        await manager.broadcast(event)
    return emit


async def _background_queue_worker():
    """
    Worker contínuo: monitora lista_videos e processa 'na_fila' um por um.
    Roda enquanto o servidor estiver ativo.
    """
    import time as _time
    batch_started_at: int | None = None
    PER_VIDEO_TIMEOUT_S = 1500

    while True:
        try:
            item = None
            for v in lista_videos:
                if v.get("status") == "na_fila" and not v.get("processado"):
                    item = v
                    break

            if item is None:
                if batch_started_at is not None:
                    now = int(_time.time() * 1000)
                    await manager.broadcast({
                        "type": "all_done", "started_at": batch_started_at,
                        "finished_at": now, "elapsed_ms": now - batch_started_at,
                    })
                    batch_started_at = None
                await asyncio.sleep(1)
                continue

            if batch_started_at is None:
                batch_started_at = int(_time.time() * 1000)
                total = sum(1 for v in lista_videos if v.get("status") == "na_fila" and not v.get("processado"))
                await manager.broadcast({"type": "batch_started", "at": batch_started_at, "total": total})

            item["status"] = "processando"
            emit_fn = criar_emit_para(item)

            try:
                idx = lista_videos.index(item)
                path = await asyncio.wait_for(
                    processar_video(item, idx, emit_fn),
                    timeout=PER_VIDEO_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                print(f"[worker] vídeo excedeu {PER_VIDEO_TIMEOUT_S}s — abortado")
                item["status"] = "erro"
                await emit_fn({"type": "error", "message": f"timeout: excedeu {PER_VIDEO_TIMEOUT_S}s"})
                continue
            except Exception as e:
                print(f"[worker] vídeo levantou {type(e).__name__}: {e}")
                item["status"] = "erro"
                await emit_fn({"type": "error", "message": str(e)})
                continue

            if not path:
                item["status"] = "erro"
                continue

            item["output_path"] = path
            item["processado"] = True

            item["status"] = "enviando_drive"
            await emit_fn({"type": "uploading"})
            try:
                pasta_dest = pastas.selecionada()
                if pasta_dest and pasta_dest.get("drive_folder_id"):
                    info = await asyncio.to_thread(drive_uploader.upload_para, pasta_dest["drive_folder_id"], path)
                else:
                    info = await asyncio.to_thread(drive_uploader.upload, path)
                
                item["drive_id"] = info["file_id"]
                item["drive_url"] = info["web_view_link"]
                item["status"] = "concluido"
                await emit_fn({"type": "uploaded", "drive_id": info["file_id"], "drive_url": info["web_view_link"]})
                
                removidos = _cleanup_local(path, item.get("url"))
                item["output_path"] = None
                await emit_fn({"type": "cleaned", "removed": removidos})
            except Exception as e:
                print(f"[drive] upload falhou: {e}")
                item["status"] = "erro_upload"
                item["upload_error"] = str(e)
                await emit_fn({"type": "upload_error", "error": str(e)})

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[worker] erro inesperado: {e}")
            await asyncio.sleep(5)


# ── Worker de Ranking (fila dedicada) ──────────────────────────────────────────

def _criar_ranking_emit(rk: dict):
    """Cria emit sync que injeta ranking_id e id, e faz broadcast via loop do servidor."""
    loop = asyncio.get_event_loop()
    def emit(ev: dict):
        ev = dict(ev)
        ev["ranking_id"] = rk.get("id", "")
        ev["id"] = rk.get("id", "")
        try:
            asyncio.run_coroutine_threadsafe(manager.broadcast(ev), loop)
            if ev.get("type") == "item_iniciado":
                prog = {
                    "type": "ranking_progress",
                    "id": rk.get("id", ""),
                    "ranking_id": rk.get("id", ""),
                    "atual": ev.get("posicao", 1),
                    "total": len(rk.get("itens", [])),
                }
                asyncio.run_coroutine_threadsafe(manager.broadcast(prog), loop)
        except Exception:
            pass
    return emit


async def _background_ranking_worker():
    """
    Worker contínuo para rankings. Processa um ranking 'na_fila' por vez,
    montando todos os itens e concatenando. Roda em paralelo à fila de vídeos.
    """
    import time as _time
    PER_ITEM_TIMEOUT_S = 600

    while True:
        try:
            rk = None
            for cand in lista_rankings:
                if cand.get("status") == "na_fila" and not cand.get("processado"):
                    rk = cand
                    break

            if rk is None:
                await asyncio.sleep(1)
                continue

            now_start = int(_time.time() * 1000)
            rk["status"] = "processando"
            rk["started_at"] = now_start
            rk["finished_at"] = None
            rk["elapsed_ms"] = None
            emit_fn = _criar_ranking_emit(rk)
            await manager.broadcast({
                "type": "ranking_status", "id": rk["id"], "ranking_id": rk["id"],
                "value": "processando", "started_at": now_start,
            })
            await manager.broadcast({"type": "ranking_iniciado", "id": rk["id"], "ranking_id": rk["id"]})

            try:
                path = await asyncio.wait_for(
                    asyncio.to_thread(ranking_p.montar_ranking, rk, emit_fn),
                    timeout=PER_ITEM_TIMEOUT_S * max(1, len(rk.get("itens", []))),
                )
            except asyncio.TimeoutError:
                rk["status"] = "erro"
                await manager.broadcast({"type": "ranking_error", "id": rk["id"], "ranking_id": rk["id"], "message": "timeout"})
                await manager.broadcast({"type": "ranking_status", "id": rk["id"], "ranking_id": rk["id"], "value": "erro"})
                continue
            except Exception as e:
                rk["status"] = "erro"
                await manager.broadcast({"type": "ranking_error", "id": rk["id"], "ranking_id": rk["id"], "message": str(e)})
                await manager.broadcast({"type": "ranking_status", "id": rk["id"], "ranking_id": rk["id"], "value": "erro"})
                continue

            if not path:
                rk["status"] = "erro"
                await manager.broadcast({"type": "ranking_error", "id": rk["id"], "ranking_id": rk["id"], "message": "Falha na geração final do vídeo"})
                await manager.broadcast({"type": "ranking_status", "id": rk["id"], "ranking_id": rk["id"], "value": "erro"})
                continue

            rk["output_path"] = path
            rk["processado"] = True

            # Upload Drive
            rk["status"] = "enviando_drive"
            await manager.broadcast({
                "type": "ranking_status", "id": rk["id"], "ranking_id": rk["id"],
                "value": "enviando_drive",
            })
            await manager.broadcast({"type": "ranking_uploading", "id": rk["id"], "ranking_id": rk["id"]})
            try:
                pasta_dest = pastas.selecionada()
                if pasta_dest and pasta_dest.get("drive_folder_id"):
                    info = await asyncio.to_thread(drive_uploader.upload_para, pasta_dest["drive_folder_id"], path)
                else:
                    info = await asyncio.to_thread(drive_uploader.upload, path)
                rk["drive_id"] = info["file_id"]
                rk["drive_url"] = info["web_view_link"]
                rk["status"] = "concluido"
                now_end = int(_time.time() * 1000)
                rk["finished_at"] = now_end
                rk["elapsed_ms"] = now_end - now_start
                await manager.broadcast({
                    "type": "ranking_status", "id": rk["id"], "ranking_id": rk["id"],
                    "value": "concluido", "drive_id": info["file_id"], "drive_url": info["web_view_link"],
                    "elapsed_ms": rk["elapsed_ms"],
                })
                await manager.broadcast({
                    "type": "ranking_done", "id": rk["id"], "ranking_id": rk["id"],
                    "drive_id": info["file_id"], "drive_url": info["web_view_link"],
                    "elapsed_ms": rk["elapsed_ms"],
                })
            except Exception as e:
                rk["status"] = "erro_upload"
                rk["upload_error"] = str(e)
                await manager.broadcast({"type": "ranking_error", "id": rk["id"], "ranking_id": rk["id"], "message": str(e)})
                await manager.broadcast({"type": "ranking_status", "id": rk["id"], "ranking_id": rk["id"], "value": "erro_upload"})

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[ranking-worker] erro inesperado: {e}")
            await asyncio.sleep(5)


# ── Modelos ───────────────────────────────────────────────────────────────────

class AddVideoRequest(BaseModel):
    url: str
    title: str | None = None

class Tarja(BaseModel):
    ativo: bool  = False
    x:     float = 0.35
    y:     float = 0.45
    w:     float = 0.30
    h:     float = 0.07
    texto: str   = ""

class NarrationItem(BaseModel):
    id:           str
    text:         str
    start_sec:    float
    freeze:       bool = False
    legenda:      bool = False


# ── Ranking (Top N) ────────────────────────────────────────────────────────────

class RankingItemModel(BaseModel):
    posicao:          int
    link:             str = ""
    duracao_original_s: float | None = None
    trim_inicio_s:    float = 0.0
    trim_fim_s:       float = 0.0
    titulo_item:      str = ""
    video_y:          int = 0
    overlay:          str | None = None
    filtro:           str = "Nenhum"
    narracao_texto:   str | None = None
    transicao_sfx:    str = "none"
    transicao_tipo:   str = "default"
    thumb_cache:      str | None = None
    status_link:      str = "verificando"
    tarja:            Tarja | None = None


class RankingModel(BaseModel):
    id:              str
    titulo_geral:    str = ""
    ordem:           str = "decrescente"
    quantidade:      int = 3
    duracao_modo:    str = "fixa"
    duracao_fixa_s:  float = 12.0
    transicao_tipo:  str = "flash"
    transicao_sfx:   str = "none"
    trilha_fundo:    str | None = None
    trilha_modo:     str = "50_50"
    hook:            dict | None = None
    outro:           dict | None = None
    legenda:         dict | None = None
    status:          str = "editando"
    itens:           list[dict] = []


class UpdateVideoRequest(BaseModel):
    title:           str             | None = None
    video_y:         int             | None = None
    overlay:         str             | None = None
    font:            str             | None = None
    title_y:         int             | None = None
    filtro:          str             | None = None
    cor_titulo:      str             | None = None
    titulo_borda:    bool            | None = None
    tarja:           Tarja           | None = None
    narrar_titulo:   bool            | None = None
    travar_inicio:   bool            | None = None
    gerar_legenda:   bool            | None = None
    estilo_legenda:  str             | None = None
    narrations:      list[NarrationItem] | None = None
    voice:           str             | None = None
    hook_ativo:      bool            | None = None
    hook_tipo:       str             | None = None
    hook_texto:      str             | None = None
    hook_som_entrada:str             | None = None
    hook_som_saida:  str             | None = None
    musica_fundo:    str             | None = None
    musica_modo:     str             | None = None
    trim_inicio_s:   float           | None = None
    trim_fim_s:      float           | None = None

class SearchRequest(BaseModel):
    tema:       str
    quantidade: int = 3

# ── Rotas ─────────────────────────────────────────────────────────────────────

@app.get("/api/gpu")
def gpu_status():
    return {
        "available": GPU_AVAILABLE,
        "codec":     CODEC_VIDEO,
        "label":     "RTX 3060 Ti (NVENC)" if GPU_AVAILABLE else "CPU (libx264)",
    }


@app.get("/api/videos")
def get_videos():
    return lista_videos


@app.post("/api/videos")
def add_video(req: AddVideoRequest):
    duracao = obter_duracao(req.url.strip())
    item = {
        "id":             str(uuid.uuid4()),
        "url":            req.url.strip(),
        "title":          req.title or proximo_titulo(),
        "duration":       duracao,
        "video_y":        VIDEO_Y_DEFAULT,
        "overlay":        "1",
        "font":           FONT_DEFAULT,
        "title_y":        TITLE_Y_DEFAULT,
        "filtro":         FILTRO_DEFAULT,
        "cor_titulo":     COR_TITULO_DEFAULT,
        "titulo_borda":   True,
        "tarja":          dict(TARJA_DEFAULT),
        "narrar_titulo":  False,
        "travar_inicio":  False,
        "narrations":     [],
        "gerar_legenda":  False,
        "estilo_legenda": "AMARELO_CLASSICO",
        "voice":          "padrao",
        "hook_ativo":     False,
        "hook_tipo":      HOOK_TIPO_DEFAULT,
        "hook_texto":     "",
        "hook_som_entrada": HOOK_SOM_ENTRADA_DEFAULT,
        "hook_som_saida":   HOOK_SOM_SAIDA_DEFAULT,
        "musica_fundo":   "none",
        "musica_modo":    "100_musica",
        "trim_inicio_s":  0.0,
        "trim_fim_s":     duracao if (duracao and duracao > 0) else 12.0,
        "status":         "editando",
        "processado":     False,
    }
    lista_videos.append(item)
    return {"idx": len(lista_videos) - 1, "video": item}


@app.delete("/api/videos/{idx}")
def delete_video(idx: int):
    if idx < 0 or idx >= len(lista_videos):
        raise HTTPException(404, "Vídeo não encontrado")
    removed = lista_videos.pop(idx)
    return {"removed": removed}


@app.patch("/api/videos/{idx}")
def update_video(idx: int, req: UpdateVideoRequest):
    if idx < 0 or idx >= len(lista_videos):
        raise HTTPException(404, "Vídeo não encontrado")
    if req.title           is not None: lista_videos[idx]["title"]          = req.title
    if req.video_y         is not None:
        lista_videos[idx]["video_y"] = max(VIDEO_Y_MIN, min(VIDEO_Y_MAX, int(req.video_y)))
    if req.overlay         is not None: lista_videos[idx]["overlay"]        = req.overlay
    if req.font            is not None: lista_videos[idx]["font"]           = req.font
    if req.title_y         is not None:
        lista_videos[idx]["title_y"] = max(TITLE_Y_MIN, min(TITLE_Y_MAX, int(req.title_y)))
    if req.filtro          is not None: lista_videos[idx]["filtro"]         = req.filtro
    if req.cor_titulo      is not None: lista_videos[idx]["cor_titulo"]     = req.cor_titulo
    if req.titulo_borda    is not None: lista_videos[idx]["titulo_borda"]   = req.titulo_borda
    if req.tarja           is not None: lista_videos[idx]["tarja"]          = req.tarja.model_dump()
    if req.narrar_titulo   is not None: lista_videos[idx]["narrar_titulo"]  = req.narrar_titulo
    if req.travar_inicio   is not None: lista_videos[idx]["travar_inicio"]  = req.travar_inicio
    if req.narrations      is not None: lista_videos[idx]["narrations"]     = [n.model_dump() for n in req.narrations]
    if req.gerar_legenda   is not None: lista_videos[idx]["gerar_legenda"]  = req.gerar_legenda
    if req.estilo_legenda  is not None: lista_videos[idx]["estilo_legenda"] = req.estilo_legenda
    if req.voice           is not None: lista_videos[idx]["voice"]          = req.voice
    if req.hook_ativo      is not None: lista_videos[idx]["hook_ativo"]     = req.hook_ativo
    if req.hook_tipo       is not None: lista_videos[idx]["hook_tipo"]      = req.hook_tipo
    if req.hook_texto      is not None: lista_videos[idx]["hook_texto"]     = req.hook_texto
    if req.hook_som_entrada is not None: lista_videos[idx]["hook_som_entrada"] = req.hook_som_entrada
    if req.hook_som_saida   is not None: lista_videos[idx]["hook_som_saida"]   = req.hook_som_saida
    if req.musica_fundo    is not None: lista_videos[idx]["musica_fundo"]   = req.musica_fundo
    if req.musica_modo     is not None: lista_videos[idx]["musica_modo"]    = req.musica_modo
    if req.trim_inicio_s   is not None: lista_videos[idx]["trim_inicio_s"]  = req.trim_inicio_s
    if req.trim_fim_s      is not None: lista_videos[idx]["trim_fim_s"]     = req.trim_fim_s
    return lista_videos[idx]


@app.post("/api/videos/{idx}/queue")
def queue_video(idx: int):
    """Coloca um vídeo individual na fila de processamento (status → na_fila)."""
    if idx < 0 or idx >= len(lista_videos):
        raise HTTPException(404, "Vídeo não encontrado")
    item = lista_videos[idx]
    if item.get("processado"):
        raise HTTPException(400, "Vídeo já foi processado")
    item["status"] = "na_fila"
    return {"ok": True, "video": item}


@app.delete("/api/videos/{idx}/queue")
def dequeue_video(idx: int):
    """Remove um vídeo da fila de processamento (status → editando)."""
    if idx < 0 or idx >= len(lista_videos):
        raise HTTPException(404, "Vídeo não encontrado")
    item = lista_videos[idx]
    if item.get("status") == "na_fila":
        item["status"] = "editando"
    return {"ok": True, "video": item}


@app.post("/api/search")
def search_viral(req: SearchRequest):
    videos = buscar_videos_virais(req.tema, req.quantidade)
    added  = []
    for v in videos:
        item = {
            "id":             str(uuid.uuid4()),
            "url":            v["url"],
            "title":          proximo_titulo(),
            "duration":       v.get("duration"),
            "video_y":        VIDEO_Y_DEFAULT,
            "overlay":        "1",
            "font":           FONT_DEFAULT,
            "title_y":        TITLE_Y_DEFAULT,
            "filtro":         FILTRO_DEFAULT,
            "cor_titulo":     COR_TITULO_DEFAULT,
        "titulo_borda":   True,
        "tarja":          dict(TARJA_DEFAULT),
            "narrar_titulo":  False,
            "travar_inicio":  False,
            "narrations":     [],
            "gerar_legenda":  False,
            "estilo_legenda": "AMARELO_CLASSICO",
            "voice":          "padrao",
            "hook_ativo":     False,
            "hook_tipo":      HOOK_TIPO_DEFAULT,
            "hook_texto":     "",
            "hook_som_entrada": HOOK_SOM_ENTRADA_DEFAULT,
            "hook_som_saida":   HOOK_SOM_SAIDA_DEFAULT,
            "musica_fundo":   "none",
            "musica_modo":    "100_musica",
            "status":         "editando",
            "processado":     False,
        }
        lista_videos.append(item)
        added.append({"idx": len(lista_videos) - 1, "video": item})
    return {"added": added, "total": len(added)}


@app.post("/api/process")
async def process_all():
    """
    Coloca todos os vídeos 'editando' na fila de processamento.
    O worker contínuo (_background_queue_worker) processa automaticamente.
    Já não bloqueia com 409 — você pode clicar PROCESSAR quantas vezes quiser.
    """
    enfileirados = 0
    for v in lista_videos:
        if v.get("status") == "editando" and not v.get("processado"):
            v["status"] = "na_fila"
            enfileirados += 1
    return {"started": enfileirados > 0, "enfileirados": enfileirados, "total": len(lista_videos)}


@app.post("/api/processing/reset")
async def reset_processing():
    """
    Cancela o worker atual e devolve vídeos travados como 'processando'
    para 'na_fila'. Útil se o worker ficou preso (Whisper/ffmpeg travado).
    """
    global _queue_worker_task, _processing
    if _queue_worker_task and not _queue_worker_task.done():
        _queue_worker_task.cancel()
        _queue_worker_task = None
        _processing = False

    reabertos = []
    for item in lista_videos:
        if item.get("status") == "processando" and not item.get("processado"):
            item["status"] = "na_fila"
            reabertos.append(item.get("id", ""))

    # Garante que o worker reinicia
    if not _queue_worker_task or _queue_worker_task.done():
        _queue_worker_task = asyncio.create_task(_background_queue_worker())

    return {"ok": True, "reabertos": reabertos}


@app.post("/api/videos/{idx}/retry-upload")
async def retry_upload(idx: int):
    """Tenta reenviar para o Drive um clip cujo upload anterior falhou."""
    if idx < 0 or idx >= len(lista_videos):
        raise HTTPException(404, "Vídeo não encontrado")
    item = lista_videos[idx]
    path = item.get("output_path")
    if not path or not os.path.exists(path):
        raise HTTPException(400, "Arquivo local não existe — não dá pra reenviar")

    item["status"] = "enviando_drive"
    await manager.broadcast({"type": "uploading", "idx": idx})
    try:
        pasta_dest = pastas.selecionada()
        if pasta_dest and pasta_dest.get("drive_folder_id"):
            info = await asyncio.to_thread(drive_uploader.upload_para, pasta_dest["drive_folder_id"], path)
        else:
            info = await asyncio.to_thread(drive_uploader.upload, path)
        item["drive_id"]  = info["file_id"]
        item["drive_url"] = info["web_view_link"]
        item["status"]    = "concluido"
        item.pop("upload_error", None)
        await manager.broadcast({
            "type": "uploaded", "idx": idx,
            "drive_id": info["file_id"], "drive_url": info["web_view_link"],
        })
        # [TESTE] Remoção de vídeos locais desabilitada
        # removidos = _cleanup_local(path, item.get("url"))
        # item["output_path"] = None
        removidos = []
        await manager.broadcast({"type": "cleaned", "idx": idx,
                                 "removed": removidos})
        return {"ok": True, "drive_url": info["web_view_link"],
                "removed": removidos}
    except Exception as e:
        item["status"]       = "erro_upload"
        item["upload_error"] = str(e)
        await manager.broadcast({"type": "upload_error", "idx": idx, "error": str(e)})
        raise HTTPException(500, f"upload falhou: {e}")


@app.delete("/api/videos/{idx}/local")
def delete_local_file(idx: int):
    """Apaga o arquivo local do clip (não tira da fila — só libera disco)."""
    if idx < 0 or idx >= len(lista_videos):
        raise HTTPException(404, "Vídeo não encontrado")
    item = lista_videos[idx]
    path = item.get("output_path")
    if not path or not os.path.exists(path):
        return {"ok": True, "already_gone": True}
    try:
        os.remove(path)
        item["output_path"] = None
        return {"ok": True}
    except OSError as e:
        raise HTTPException(500, f"falha ao apagar: {e}")


@app.get("/api/drive/status")
def drive_status():
    """Mostra se o Drive está configurado (credentials/token)."""
    return drive_uploader.status()


# ── Pastas (destino do upload no Drive) ─────────────────────────────────────

@app.get("/api/pastas")
def listar_pastas():
    return {
        "pastas": pastas.listar(),
        "selecionada": pastas.selecionada(),
    }


@app.post("/api/pastas")
def adicionar_pasta(req: dict):
    nome = req.get("nome", "").strip()
    link = req.get("drive_link", "").strip()
    if not nome or not link:
        raise HTTPException(400, "nome e drive_link são obrigatórios")
    nova = pastas.adicionar(nome, link)
    if nova is None:
        raise HTTPException(400, "Não foi possível extrair o ID da pasta do link. Use um link do tipo drive.google.com/drive/folders/XXX")
    return nova


@app.delete("/api/pastas/{pasta_id}")
def remover_pasta(pasta_id: str):
    if not pastas.remover(pasta_id):
        raise HTTPException(404, "Pasta não encontrada")
    return {"ok": True}


@app.put("/api/pastas/selecionada")
def selecionar_pasta(req: dict):
    id_ = req.get("id", "")
    if not pastas.definir_selecionada(id_):
        raise HTTPException(404, "Pasta não encontrada")
    return {"ok": True, "pasta": pastas.selecionada()}


@app.get("/api/clips")
def list_clips():
    clips_dir = Path(OUTPUT_DIR)
    if not clips_dir.exists():
        return []
    files = sorted(clips_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        {
            "filename": f.name,
            "size_mb":  round(f.stat().st_size / 1_048_576, 1),
            "url":      f"/api/clips/{f.name}",
        }
        for f in files
    ]


@app.get("/api/clips/{filename}")
def serve_clip(filename: str):
    path = Path(OUTPUT_DIR) / filename
    if not path.exists():
        raise HTTPException(404, "Arquivo não encontrado")
    return FileResponse(str(path), media_type="video/mp4",
                        filename=filename)


@app.get("/api/overlays")
def list_overlays():
    result = []
    for key, path in OVERLAYS.items():
        # cache-bust por mtime (assim o front recarrega a imagem após substituir)
        try:
            mtime = int(os.path.getmtime(path))
        except OSError:
            mtime = 0
        result.append({
            "id":     key,
            "exists": os.path.exists(path),
            "url":    f"/api/overlay/{key}?v={mtime}",
        })
    return result


@app.get("/api/overlay/{key}")
def serve_overlay(key: str):
    path = OVERLAYS.get(key)
    if not path or not os.path.exists(path):
        raise HTTPException(404, "Overlay não encontrado")
    return FileResponse(path, media_type="image/png")


def _next_overlay_key() -> str:
    """Próxima chave numérica livre (1, 2, 3, ...) na raiz."""
    existentes = {int(k) for k in OVERLAYS.keys()}
    i = 1
    while i in existentes:
        i += 1
    return str(i)


@app.post("/api/overlays")
async def upload_overlay(file: UploadFile = File(...)):
    """Recebe um PNG e salva como overlayN.png na raiz do projeto.

    Aceita apenas PNG. Limite de tamanho 10 MB.
    """
    if not file.filename:
        raise HTTPException(400, "Arquivo sem nome")

    content_type = (file.content_type or "").lower()
    name_lower = file.filename.lower()
    if "png" not in content_type and not name_lower.endswith(".png"):
        raise HTTPException(400, "Apenas arquivos PNG são aceitos")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Arquivo vazio")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "Arquivo maior que 10 MB")

    # Validação leve: começa com a assinatura PNG?
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(400, "Conteúdo não é um PNG válido")

    key = _next_overlay_key()
    dest = overlay_path(key)
    os.makedirs(ROOT, exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)

    try:
        mtime = int(os.path.getmtime(dest))
    except OSError:
        mtime = 0

    return {
        "id":     key,
        "exists": True,
        "url":    f"/api/overlay/{key}?v={mtime}",
    }


@app.delete("/api/overlays/{key}")
def delete_overlay(key: str):
    """Remove o overlayN.png da raiz. Não renumera outros overlays."""
    path = OVERLAYS.get(key)
    if not path:
        raise HTTPException(404, "Overlay não encontrado")
    try:
        os.remove(path)
    except OSError as e:
        raise HTTPException(500, f"Falha ao remover: {e}")

    # Se algum vídeo na fila usava esse overlay, realoca para o primeiro disponível
    restantes = list(OVERLAYS.keys())
    fallback = restantes[0] if restantes else "1"
    for v in lista_videos:
        if v.get("overlay") == key:
            v["overlay"] = fallback

    return {"ok": True, "deleted": key}


@app.get("/api/titles/random")
def random_title():
    from video_processor import proximo_titulo
    return {"title": proximo_titulo()}

@app.get("/api/hooks/random")
def random_hook():
    from video_processor import proximo_gancho
    return {"hook": proximo_gancho()}


@app.get("/api/frame")
def get_frame(url: str, t: float = 3.0):
    """Extrai (e cacheia) 1 frame do vídeo para o tempo t no preview. Roda em threadpool
    (def sync) — não bloqueia a fila de processamento."""
    vid = _extrair_video_id(url)
    if not vid:
        raise HTTPException(400, "URL inválida")
    cache = os.path.join(FRAMES_DIR, f"{vid}_t{t:.1f}.jpg")
    if not os.path.exists(cache):
        ok = extrair_frame(url, cache, t=t)
        if not ok or not os.path.exists(cache):
            raise HTTPException(404, "Frame indisponível")
    return FileResponse(cache, media_type="image/jpeg")


@app.get("/api/options")
def get_options():
    """Opções de fonte/filtro/altura para o frontend montar os controles."""
    return {
        "fonts":   list(FONTS.keys()),
        "font_default":   FONT_DEFAULT,
        "filtros": FILTROS,
        "filtro_default": FILTRO_DEFAULT,
        "title_y": {"min": TITLE_Y_MIN, "max": TITLE_Y_MAX, "default": TITLE_Y_DEFAULT},
        "video_y": {"min": VIDEO_Y_MIN, "max": VIDEO_Y_MAX, "default": VIDEO_Y_DEFAULT},
        "cores":   CORES_TITULO,
        "cor_default": COR_TITULO_DEFAULT,
        "hook_tipos":  HOOK_TIPOS,
        "hook_tipo_default":  HOOK_TIPO_DEFAULT,
        "hook_som_opcoes":    HOOK_SOM_OPCOES,
        "hook_som_entrada_default": HOOK_SOM_ENTRADA_DEFAULT,
        "hook_som_saida_default":   HOOK_SOM_SAIDA_DEFAULT,
        "hook_texto_default": HOOK_TEXT_DEFAULT,
        "hook_duracao":       HOOK_DURATION_S,
    }


@app.get("/api/narration-voices")
def narration_voices():
    """Lista vozes disponíveis para narração: Padrão (Piper) + vozes XTTS."""
    from narration import PIPER_AVAILABLE
    vozes = [
        {"id": "padrao", "label": "Padrão (Piper)", "desc": "TTS local rápido" if PIPER_AVAILABLE else "TTS local indisponível", "tipo": "local"},
    ]
    # Tenta buscar vozes do XTTS
    try:
        import json, urllib.request
        from narration import XTTS_BASE_URL
        req = urllib.request.Request(f"{XTTS_BASE_URL}/voz/voices", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            xtts_vozes = json.loads(resp.read())
        for v in xtts_vozes:
            vozes.append({
                "id": v["id"],
                "label": v["label"],
                "desc": v.get("desc", f"XTTS — {v['label']}"),
                "tipo": v.get("tipo", "xtts"),
            })
    except Exception as e:
        print(f"[narration-voices] XTTS indisponível: {e}")
        vozes.append({"id": "", "label": "XTTS offline", "desc": "Serviço de voz IA não está rodando", "tipo": "offline"})
    return vozes


@app.get("/api/sfx")
def list_sfx():
    """Lista arquivos de som (efeitos sonoros) disponíveis em SFX_DIR."""
    if not os.path.isdir(SFX_DIR):
        return []
    exts = {".mp3", ".wav", ".ogg", ".m4a"}
    files = []
    for f in os.listdir(SFX_DIR):
        name, ext = os.path.splitext(f)
        if ext.lower() in exts:
            files.append({"id": name, "file": f, "label": name.replace("_", " ").title()})
    return sorted(files, key=lambda x: x["id"])


@app.get("/api/music")
def list_music():
    """Lista arquivos de trilha sonora disponíveis em MUSIC_DIR."""
    if not os.path.isdir(MUSIC_DIR):
        return []
    exts = {".mp3", ".wav", ".ogg", ".m4a", ".flac"}
    files = []
    for f in os.listdir(MUSIC_DIR):
        name, ext = os.path.splitext(f)
        if ext.lower() in exts:
            files.append({"id": name, "file": f, "label": name.replace("_", " ").title()})
    return sorted(files, key=lambda x: x["id"])
# ── Ranking (Top N) ────────────────────────────────────────────────────────────

class CreateRankingRequest(BaseModel):
    titulo_geral:  str = ""
    quantidade:    int = 3
    ordem:         str = "decrescente"
    overlay:       str | None = None
    narrar_titulo_geral: bool = False
    legendar_titulo_geral: bool = False


@app.post("/api/ranking")
def criar_ranking(req: CreateRankingRequest):
    """Cria um ranking com N itens vazios (posições 1..N)."""
    qtd = req.quantidade if req.quantidade in RANKING_QUANTIDADES else RANKING_QUANTIDADES[0]
    itens = [{
        "posicao": i + 1, "link": "", "duracao_original_s": None,
        "trim_inicio_s": 0.0, "trim_fim_s": 0.0, "titulo_item": "",
        "video_y": 0, "overlay": None, "filtro": "Nenhum",
        "narracao_texto": None, "thumb_cache": None, "status_link": "verificando",
        "tarja": dict(TARJA_DEFAULT),
        "transicao_tipo": "fade_preto",
        "transicao_sfx": "click",
    } for i in range(qtd)]
    rk = {
        "id": str(uuid.uuid4()),
        "titulo_geral": req.titulo_geral,
        "ordem": req.ordem if req.ordem in ("decrescente", "crescente") else RANKING_ORDEM_DEFAULT,
        "quantidade": qtd,
        "overlay": "3",
        "narrar_titulo_geral": False,
        "narrar_titulos_itens": False,
        "gerar_legenda": False,
        "legendar_titulo_geral": req.legendar_titulo_geral,
        "transicao_tipo": "fade_preto",
        "transicao_sfx": "click",
        "trilha_fundo": None,
        "trilha_modo": "50_50",
        "hook": None,
        "outro": {"texto": RANKING_OUTRO_DEFAULT_TEXTO, "estilo": RANKING_OUTRO_DEFAULT},
        "legenda": {"ativa": False, "estilo": "AMARELO_CLASSICO"},
        "status": "editando",
        "processado": False,
        "itens": itens,
        "title_y": 220,
        "font": "Padrão",
        "cor_titulo": "Branco",
        "titulo_borda": True,
        "itens_y": 740,
        "esquema_cores": "roxo_verde",
    }
    lista_rankings.append(rk)
    return rk


@app.get("/api/ranking")
def listar_rankings():
    return lista_rankings


@app.get("/api/ranking/{rid}")
def detalhe_ranking(rid: str):
    rk = _buscar_ranking(rid)
    if not rk:
        raise HTTPException(404, "Ranking não encontrado")
    return rk


@app.patch("/api/ranking/{rid}")
def editar_ranking(rid: str, req: dict):
    rk = _buscar_ranking(rid)
    if not rk:
        raise HTTPException(404, "Ranking não encontrado")
    campos = ["titulo_geral", "ordem", "quantidade", "overlay", "narrar_titulo_geral", "legendar_titulo_geral",
              "narrar_titulos_itens", "transicao_tipo", "transicao_sfx", "trilha_fundo", "trilha_modo",
              "hook", "outro", "legenda", "status", "title_y", "font", "cor_titulo", "titulo_borda", "itens_y", "esquema_cores"]
    for c in campos:
        if c in req and req[c] is not None:
            rk[c] = req[c]
            
    # Ajustar quantidade de itens se alterou
    if "quantidade" in req and req["quantidade"] is not None:
        qtd = req["quantidade"]
        itens = rk.get("itens", [])
        if len(itens) > qtd:
            rk["itens"] = itens[:qtd]
        elif len(itens) < qtd:
            for i in range(len(itens), qtd):
                itens.append({
                    "posicao": i + 1, "link": "", "duracao_original_s": None,
                    "trim_inicio_s": 0.0, "trim_fim_s": 0.0, "titulo_item": "",
                    "video_y": 0, "overlay": None, "filtro": "Nenhum",
                    "narracao_texto": None, "thumb_cache": None, "status_link": "verificando",
                    "tarja": dict(TARJA_DEFAULT),
                    "transicao_tipo": "fade_preto",
                    "transicao_sfx": "default",
                })
            rk["itens"] = itens

    return rk


@app.delete("/api/ranking/{rid}")
def remover_ranking(rid: str):
    global lista_rankings
    rk = _buscar_ranking(rid)
    if not rk:
        raise HTTPException(404, "Ranking não encontrado")
    lista_rankings = [r for r in lista_rankings if r["id"] != rid]
    return {"ok": True}


@app.post("/api/ranking/items/duracao")
def ranking_item_duracao(req: dict):
    """Recebe um link e devolve a duração (sem baixar)."""
    link = (req.get("link") or "").strip()
    if not link:
        raise HTTPException(400, "link obrigatório")
    dur = obter_duracao(link)
    return {"duracao": dur}


@app.post("/api/ranking/{rid}/items/{posicao}")
def definir_item(rid: str, posicao: int, req: dict):
    rk = _buscar_ranking(rid)
    if not rk:
        raise HTTPException(404, "Ranking não encontrado")
    item = next((it for it in rk["itens"] if it["posicao"] == posicao), None)
    if not item:
        raise HTTPException(404, "Posição não encontrada")
    old_link = item.get("link", "")
    new_link = (req.get("link") or "").strip()
    link_changed = bool(new_link and new_link != old_link)

    for campo in ["link", "trim_inicio_s", "trim_fim_s", "titulo_item", "video_y",
                  "overlay", "filtro", "narracao_texto", "thumb_cache", "transicao_sfx", "transicao_tipo"]:
        if campo in req and req[campo] is not None:
            item[campo] = req[campo]
            
    if "tarja" in req and req["tarja"] is not None:
        item["tarja"] = req["tarja"]

    # Valida link + busca duração
    if new_link:
        if link_changed or not item.get("duracao_original_s"):
            dur = obter_duracao(new_link)
            item["duracao_original_s"] = dur
            item["status_link"] = "ok" if (dur and dur > 0) else "invalido"
        else:
            dur = item.get("duracao_original_s")

        if link_changed:
            item["trim_inicio_s"] = 0.0
            item["trim_fim_s"] = float(dur) if dur else rk.get("duracao_fixa_s", 12.0)
        else:
            if not item["trim_fim_s"] or item["trim_fim_s"] <= item["trim_inicio_s"]:
                item["trim_fim_s"] = float(dur) if dur else rk.get("duracao_fixa_s", 12.0)
            elif dur and item["trim_fim_s"] > dur:
                item["trim_fim_s"] = float(dur)
    return item


@app.patch("/api/ranking/{rid}/reorder")
def reordenar_ranking(rid: str, req: dict):
    """Recebe {'order': [pos1, pos2, ...]} — reatribui posições na nova ordem."""
    rk = _buscar_ranking(rid)
    if not rk:
        raise HTTPException(404, "Ranking não encontrado")
    nova_ordem = req.get("order") or []
    if not nova_ordem:
        return rk
    por_pos = {it["posicao"]: it for it in rk["itens"]}
    novos = []
    for novo_idx, velha_pos in enumerate(nova_ordem, start=1):
        it = por_pos.get(velha_pos)
        if it:
            it["posicao"] = novo_idx
            novos.append(it)
    if novos:
        rk["itens"] = novos
    return rk


@app.post("/api/ranking/{rid}/queue")
def enfileirar_ranking(rid: str):
    rk = _buscar_ranking(rid)
    if not rk:
        raise HTTPException(404, "Ranking não encontrado")
    rk["status"] = "na_fila"
    rk["processado"] = False
    return {"ok": True, "ranking": rk}


@app.delete("/api/ranking/{rid}/queue")
def desenfileirar_ranking(rid: str):
    rk = _buscar_ranking(rid)
    if not rk:
        raise HTTPException(404, "Ranking não encontrado")
    if rk.get("status") == "na_fila":
        rk["status"] = "editando"
    return {"ok": True, "ranking": rk}

@app.post("/api/ranking/{rid}/reprocess")
def reprocessar_ranking(rid: str):
    """Reprocessa um ranking que já foi concluído ou falhou."""
    rk = _buscar_ranking(rid)
    if not rk:
        raise HTTPException(404, "Ranking não encontrado")
    
    rk["status"] = "editando"
    rk["processado"] = False
    rk["output_path"] = None
    rk["drive_id"] = None
    rk["drive_url"] = None
    rk["upload_error"] = None
    if "outro" in rk:
        rk["outro"]["estilo"] = "none"
    
    return {"ok": True, "ranking": rk}


@app.post("/api/ranking/process")
async def processar_rankings():
    enfileirados = 0
    for rk in lista_rankings:
        if rk.get("status") == "editando" and not rk.get("processado"):
            rk["status"] = "na_fila"
            enfileirados += 1
    return {"started": enfileirados > 0, "enfileirados": enfileirados, "total": len(lista_rankings)}


@app.get("/api/ranking/{rid}/frame")
def ranking_frame(rid: str, posicao: int = 1, t: float = 3.0):
    """Frame de preview de um item (reaproveita extrair_frame no link)."""
    rk = _buscar_ranking(rid)
    if not rk:
        raise HTTPException(404, "Ranking não encontrado")
    item = next((it for it in rk["itens"] if it["posicao"] == posicao), None)
    if not item or not item.get("link"):
        raise HTTPException(400, "item sem link")
    fd, out = tempfile.mkstemp(suffix=".jpg", prefix="rk_frame_")
    os.close(fd)
    if extrair_frame(item["link"], out, t):
        return FileResponse(out, media_type="image/jpeg")
    raise HTTPException(404, "Frame indisponível")


def _buscar_ranking(rid: str) -> dict | None:
    for rk in lista_rankings:
        if rk["id"] == rid:
            return rk
    return None


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/progress")
async def ws_progress(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()   # mantém conexão viva
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ── Startup (inicia worker contínuo) ────────────────────────────────────────────

@app.on_event("startup")
async def _start_worker():
    global _queue_worker_task, _ranking_worker_task
    _queue_worker_task = asyncio.create_task(_background_queue_worker())
    _ranking_worker_task = asyncio.create_task(_background_ranking_worker())
    print("[worker] fila contínua (vídeos + rankings) iniciada")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8090, reload=False)
