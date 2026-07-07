"""
Uploader para Google Drive — fluxo:
  - autentica via OAuth (browser na primeira vez, token cacheado depois)
  - garante a pasta 'clips-prontos' no Drive (cria se não existir)
  - upload resumable do arquivo, devolve {file_id, web_view_link}

Caminhos:
  C:\\Users\\78787\\.gdrive\\credentials.json   (vem do Google Cloud Console)
  C:\\Users\\78787\\.gdrive\\token.json         (gerado no 1º login, reusado)

Scope mínimo: drive.file → só vê os arquivos que ele mesmo criou.
"""
from __future__ import annotations

import os
import sys
import threading
from pathlib import Path
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload


# ── Config ────────────────────────────────────────────────────────────────────

SCOPES = ["https://www.googleapis.com/auth/drive.file"]

_GDRIVE_DIR    = Path(r"C:\Users\78787\.gdrive")
CREDENTIALS    = _GDRIVE_DIR / "credentials.json"
TOKEN_FILE     = _GDRIVE_DIR / "token.json"

PASTA_DESTINO  = "clips-prontos"


def _safe_print(*args):
    text = " ".join(str(a) for a in args)
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        enc = sys.stdout.encoding or "utf-8"
        print(text.encode(enc, errors="replace").decode(enc, errors="replace"),
              flush=True)


# ── Auth + service singleton ──────────────────────────────────────────────────

_service     = None
_folder_id   = None
_lock        = threading.RLock()   # RLock: reentrante. _garantir_pasta chama _service_singleton — ambos pegam o mesmo lock.


def _autenticar() -> Credentials:
    """Devolve Credentials válidas: refresh ou OAuth flow no browser."""
    if not CREDENTIALS.exists():
        raise FileNotFoundError(
            f"credentials.json não encontrado em {CREDENTIALS}.\n"
            f"Baixe do Google Cloud Console → OAuth client (Desktop) e salve lá."
        )

    creds: Optional[Credentials] = None
    if TOKEN_FILE.exists():
        try:
            creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
        except Exception as e:
            _safe_print(f"[drive] token.json inválido ({e}), refazendo login")
            creds = None

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
            return creds
        except Exception as e:
            _safe_print(f"[drive] refresh falhou ({e}), refazendo login")

    # Primeiro login (ou refresh inviável) — abre browser
    _safe_print("[drive] abrindo browser para autorização OAuth...")
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS), SCOPES)
    creds = flow.run_local_server(port=0, open_browser=True)
    TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    _safe_print(f"[drive] token salvo em {TOKEN_FILE}")
    return creds


def _service_singleton():
    """Build cacheado do service do Drive."""
    global _service
    with _lock:
        if _service is None:
            creds = _autenticar()
            _service = build("drive", "v3", credentials=creds,
                             cache_discovery=False)
    return _service


def _garantir_pasta() -> str:
    """Cria ou reusa a pasta 'clips-prontos' no root do Drive. Devolve fileId."""
    global _folder_id
    with _lock:
        if _folder_id:
            return _folder_id

        svc = _service_singleton()
        # Procura pasta existente criada por este app
        query = (
            f"mimeType='application/vnd.google-apps.folder' "
            f"and name='{PASTA_DESTINO}' and trashed=false"
        )
        resp = svc.files().list(
            q=query, spaces="drive", fields="files(id, name)", pageSize=10
        ).execute()
        encontrados = resp.get("files", [])
        if encontrados:
            _folder_id = encontrados[0]["id"]
            _safe_print(f"[drive] pasta '{PASTA_DESTINO}' encontrada: {_folder_id}")
            return _folder_id

        # Não existe: cria
        meta = {
            "name":     PASTA_DESTINO,
            "mimeType": "application/vnd.google-apps.folder",
        }
        nova = svc.files().create(body=meta, fields="id").execute()
        _folder_id = nova["id"]
        _safe_print(f"[drive] pasta '{PASTA_DESTINO}' criada: {_folder_id}")
        return _folder_id


# ── API pública ───────────────────────────────────────────────────────────────

def status() -> dict:
    """Estado do Drive: credentials? token? autenticado?"""
    return {
        "credentials_present": CREDENTIALS.exists(),
        "token_present":       TOKEN_FILE.exists(),
        "credentials_path":    str(CREDENTIALS),
        "pasta_destino":       PASTA_DESTINO,
    }


def upload(local_path: str | os.PathLike,
           nome_remoto: Optional[str] = None) -> dict:
    """
    Upload resumable de um arquivo para a pasta 'clips-prontos' no Drive.
    Retorna {"file_id": str, "web_view_link": str, "name": str}.
    Lança em caso de falha — chamador decide retry/cleanup.
    """
    return _upload_para_pasta(local_path, _garantir_pasta(), nome_remoto)


def upload_para(dest_folder_id: str,
                local_path: str | os.PathLike,
                nome_remoto: Optional[str] = None) -> dict:
    """Upload para uma pasta específica (pelo ID do Drive)."""
    return _upload_para_pasta(local_path, dest_folder_id, nome_remoto)


def _upload_para_pasta(local_path: str | os.PathLike,
                       folder_id: str,
                       nome_remoto: Optional[str] = None) -> dict:
    local = Path(local_path)
    if not local.exists():
        raise FileNotFoundError(f"arquivo local inexistente: {local}")

    svc = _service_singleton()

    nome = nome_remoto or local.name
    meta = {"name": nome, "parents": [folder_id]}

    media = MediaFileUpload(
        str(local),
        mimetype="video/mp4",
        resumable=True,
        chunksize=8 * 1024 * 1024,  # 8 MB
    )

    _safe_print(f"[drive] subindo {nome} ({local.stat().st_size / 1_048_576:.1f} MB)...")
    req = svc.files().create(
        body=meta, media_body=media,
        fields="id, name, webViewLink",
    )

    response = None
    while response is None:
        status_chunk, response = req.next_chunk()
        if status_chunk:
            pct = int(status_chunk.progress() * 100)
            _safe_print(f"[drive] {nome}  {pct}%")

    _safe_print(f"[drive] OK: {response.get('id')}  {response.get('webViewLink')}")
    return {
        "file_id":       response["id"],
        "web_view_link": response.get("webViewLink", ""),
        "name":          response.get("name", nome),
    }


def deletar(file_id: str) -> bool:
    """Apaga um arquivo do Drive (permanente). True se ok."""
    try:
        svc = _service_singleton()
        svc.files().delete(fileId=file_id).execute()
        return True
    except HttpError as e:
        _safe_print(f"[drive] delete falhou: {e}")
        return False
