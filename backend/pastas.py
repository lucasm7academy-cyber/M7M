import json
import os
import re
import threading
from typing import Optional

_PASTAS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pastas.json")
_lock = threading.Lock()

_pastas: list[dict] = []
_pasta_selecionada_id: Optional[str] = None

def _extrair_folder_id(link: str) -> Optional[str]:
    m = re.search(r"(?:folders/|id=)([a-zA-Z0-9_-]+)", link)
    return m.group(1) if m else None

def _salvar():
    with open(_PASTAS_FILE, "w", encoding="utf-8") as f:
        json.dump({"pastas": _pastas, "selecionada": _pasta_selecionada_id}, f, indent=2)

def _carregar():
    global _pastas, _pasta_selecionada_id
    if not os.path.exists(_PASTAS_FILE):
        return
    try:
        with open(_PASTAS_FILE, "r", encoding="utf-8") as f:
            d = json.load(f)
        _pastas = d.get("pastas", [])
        _pasta_selecionada_id = d.get("selecionada")
    except Exception:
        pass

_carregar()

# ── API pública ────────────────────────────────────────────────────────────────

def listar() -> list[dict]:
    with _lock:
        return list(_pastas)

def selecionada() -> Optional[dict]:
    with _lock:
        if _pasta_selecionada_id is None and _pastas:
            return _pastas[0]
        for p in _pastas:
            if p["id"] == _pasta_selecionada_id:
                return p
        return _pastas[0] if _pastas else None

def definir_selecionada(id_: str) -> bool:
    global _pasta_selecionada_id
    with _lock:
        for p in _pastas:
            if p["id"] == id_:
                _pasta_selecionada_id = id_
                _salvar()
                return True
        return False

def adicionar(nome: str, drive_link: str) -> Optional[dict]:
    global _pasta_selecionada_id
    folder_id = _extrair_folder_id(drive_link)
    if not folder_id:
        return None
    with _lock:
        nova = {
            "id": str(len(_pastas) + 1),
            "nome": nome,
            "drive_link": drive_link,
            "drive_folder_id": folder_id,
        }
        _pastas.append(nova)
        if _pasta_selecionada_id is None:
            _pasta_selecionada_id = nova["id"]
        _salvar()
        return nova

def remover(id_: str) -> bool:
    global _pasta_selecionada_id
    with _lock:
        before = len(_pastas)
        _pastas[:] = [p for p in _pastas if p["id"] != id_]
        if len(_pastas) == before:
            return False
        if _pasta_selecionada_id == id_:
            _pasta_selecionada_id = _pastas[0]["id"] if _pastas else None
        _salvar()
        return True

def obter(id_: str) -> Optional[dict]:
    with _lock:
        for p in _pastas:
            if p["id"] == id_:
                return dict(p)
        return None
