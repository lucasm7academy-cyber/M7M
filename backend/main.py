from __future__ import annotations

import asyncio
import json
import os
import sys
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
        removidos = _cleanup_local(path, item.get("url"))
        item["output_path"] = None
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
def get_frame(url: str):
    """Extrai (e cacheia) 1 frame do vídeo para o preview. Roda em threadpool
    (def sync) — não bloqueia a fila de processamento."""
    vid = _extrair_video_id(url)
    if not vid:
        raise HTTPException(400, "URL inválida")
    cache = os.path.join(FRAMES_DIR, f"{vid}.jpg")
    if not os.path.exists(cache):
        ok = extrair_frame(url, cache)
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
    global _queue_worker_task
    _queue_worker_task = asyncio.create_task(_background_queue_worker())
    print("[worker] fila contínua iniciada")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8090, reload=False)
