import yt_dlp
import os
import sys
import urllib.request
import urllib.error
import http.client


import re
import unicodedata


_STOPWORDS = {
    "de", "do", "da", "dos", "das", "e", "o", "a", "os", "as",
    "para", "com", "no", "na", "em", "um", "uma", "the", "of", "and",
    "shorts", "short", "viral",
}


def _normalizar(texto: str) -> str:
    """Lowercase + remove acentos + só alfanumérico/espaço."""
    if not texto:
        return ""
    texto = unicodedata.normalize("NFKD", texto)
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    texto = texto.lower()
    texto = re.sub(r"[^a-z0-9\s]", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()


def _tokens_tema(tema: str) -> set[str]:
    """Tokens do tema, sem stopwords, mín. 2 chars."""
    return {
        t for t in _normalizar(tema).split()
        if len(t) >= 2 and t not in _STOPWORDS
    }


def _titulo_combina(titulo: str, tokens_tema: set[str]) -> bool:
    """
    True se ao menos UM token significativo do tema aparece no título
    normalizado. Tema vazio (sem tokens) → aceita tudo (compatibilidade).
    """
    if not tokens_tema:
        return True
    titulo_norm = _normalizar(titulo)
    if not titulo_norm:
        return False
    palavras = set(titulo_norm.split())
    # match exato OU substring (cobre "leagueoflegends" em tags coladas)
    for token in tokens_tema:
        if token in palavras:
            return True
        if token in titulo_norm:
            return True
    return False


def _safe_print(*args):
    """print() resistente a emojis em consoles cp1252 (Windows)."""
    text = " ".join(str(a) for a in args)
    try:
        print(text)
    except UnicodeEncodeError:
        enc = (sys.stdout.encoding or "utf-8")
        print(text.encode(enc, errors="replace").decode(enc, errors="replace"))

_BASE = os.path.dirname(os.path.abspath(__file__))
BLACKLIST_FILE = os.path.normpath(os.path.join(_BASE, "..", "usados.txt"))

MAX_DURATION = 60   # segundos — apenas Shorts (≤ 1 minuto)


def carregar_blacklist() -> set:
    if not os.path.exists(BLACKLIST_FILE):
        return set()
    with open(BLACKLIST_FILE, "r", encoding="utf-8") as f:
        return set(line.strip() for line in f if line.strip())


def salvar_na_blacklist(video_id: str):
    with open(BLACKLIST_FILE, "a", encoding="utf-8") as f:
        f.write(video_id + "\n")


# ── helpers ───────────────────────────────────────────────────────────────────

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Impede follow de redirects — queremos VER o 30x."""
    def http_error_301(self, req, fp, code, msg, headers):
        raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)
    def http_error_302(self, req, fp, code, msg, headers):
        raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)
    http_error_303 = http_error_302
    http_error_307 = http_error_302
    http_error_308 = http_error_302


_opener_noredir = urllib.request.build_opener(_NoRedirect())


def _eh_shorts_pela_url(vid_id: str) -> bool:
    """
    Bate em /shorts/<id> SEM seguir redirect.
    - Short real           → 200 OK (a página /shorts/<id> renderiza)
    - Vídeo normal (longo) → 303/302 para /watch?v=<id>
    - Indisponível         → 404/410

    O `webpage_url` que o yt-dlp devolve é sempre normalizado para
    /watch, então este teste de URL é o único confiável.
    """
    url = f"https://www.youtube.com/shorts/{vid_id}"
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0 Safari/537.36"
                ),
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            },
        )
        resp = _opener_noredir.open(req, timeout=10)
        # 200 sem redirect → é Short real
        return resp.status == 200 and "/shorts/" in resp.geturl()
    except urllib.error.HTTPError as e:
        # 30x = YouTube tirou de /shorts/ → NÃO é Short
        # 4xx/5xx = vídeo indisponível
        return False
    except (urllib.error.URLError, TimeoutError, http.client.HTTPException, Exception):
        return False


def _validar_short(vid_id: str) -> tuple[bool, int, str]:
    """
    Confirma que o vídeo é Short. Retorna (is_short, duration, shorts_url).

    Duas barreiras OBRIGATÓRIAS:
      1) Teste de URL: /shorts/<id> renderiza sem redirect (Short real).
      2) yt-dlp confirma duração ≤ 60s.
    Ambas precisam passar. Se qualquer uma falhar, descarta.
    """
    # Barreira 1: URL canônica /shorts/<id>
    if not _eh_shorts_pela_url(vid_id):
        return False, 0, ""

    # Barreira 2: yt-dlp confirma duração
    try:
        with yt_dlp.YoutubeDL({
            "quiet":         True,
            "skip_download": True,
            "no_warnings":   True,
            "socket_timeout": 20,
        }) as ydl:
            info = ydl.extract_info(
                f"https://www.youtube.com/watch?v={vid_id}",
                download=False,
            )
        if not info:
            return False, 0, ""

        duracao = int(info.get("duration") or 0)
        # Duração tem que ser conhecida E ≤ 60s — sem fallback, sem benefício da dúvida
        if duracao <= 0 or duracao > MAX_DURATION:
            return False, duracao, ""

        shorts_url = f"https://www.youtube.com/shorts/{vid_id}"
        return True, duracao, shorts_url

    except Exception as e:
        _safe_print(f"    validação falhou para {vid_id}: {e}")
        return False, 0, ""


# ── busca ─────────────────────────────────────────────────────────────────────

def buscar_videos_virais(tema: str, quantidade: int) -> list[dict]:
    """
    Busca Shorts do YouTube (≤60s) sobre o tema.
    Nunca repete vídeos já presentes em usados.txt.

    Estratégia em duas fases:
      1. extract_flat em lote (rápido) para descobrir candidatos a partir
         de fontes que tendem a devolver Shorts.
      2. validação por vídeo (2ª chamada yt-dlp + HEAD no /shorts/) que
         confirma URL canônica /shorts/ E duração ≤60s. Ambas obrigatórias.
    """
    _safe_print(f"Buscando {quantidade} Shorts sobre '{tema}'...")
    resultados = []
    blacklist  = carregar_blacklist()
    vistos: set[str] = set()

    ydl_opts = {
        "quiet":         True,
        "skip_download": True,
        "extract_flat":  True,
        "no_warnings":   True,
        "socket_timeout": 20,
    }

    # Fontes ordenadas por **relevância ao tema** (não por confiabilidade
    # do formato — o filtro Shorts cuida disso). ytsearch SEM "#shorts" é
    # usado porque o yt-dlp trata "#shorts" como texto literal e estraga
    # a relevância — devolve trending genérico em vez do tema.
    hashtag = "".join(ch for ch in tema.lower() if ch.isalnum())
    tema_q  = tema.replace(" ", "+")
    queries = [
        # 1) hashtag/shorts: máxima relevância + 100% Shorts (quando existe)
        f"https://www.youtube.com/hashtag/{hashtag}/shorts",
        # 2) busca direta pelo tema, filtro "under 4 min" (sp=EgIYAQ%3D%3D)
        #    — Shorts e vídeos curtos misturados, filtro descarta os longos
        f"https://www.youtube.com/results?search_query={tema_q}+shorts&sp=EgIYAQ%3D%3D",
        # 3) ytsearch direto pelo tema (sem "#shorts" no texto pra não poluir)
        f"ytsearch50:{tema}",
    ]

    tokens = _tokens_tema(tema)
    _safe_print(f"  tokens do tema: {sorted(tokens) or '(nenhum — sem filtro de relevância)'}")
    descartados = {"blacklist": 0, "longo_flat": 0, "nao_shorts": 0,
                   "duracao_invalida": 0, "off_topic": 0}

    for query in queries:
        if len(resultados) >= quantidade:
            break

        _safe_print(f"  Query: {query}")
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(query, download=False)
        except Exception as e:
            _safe_print(f"  Erro na query: {e}")
            continue

        if not info or "entries" not in info:
            continue

        # Loop interno com try/except POR CANDIDATO — um erro em um vídeo
        # (encoding de título, vídeo indisponível, etc.) NUNCA aborta a
        # iteração da query inteira. Esse era o bug que zerava resultados.
        for entry in (info["entries"] or []):
            try:
                if not entry or "id" not in entry:
                    continue

                vid_id = entry.get("id", "")

                if vid_id in blacklist or vid_id in vistos:
                    if vid_id in blacklist:
                        descartados["blacklist"] += 1
                    continue
                vistos.add(vid_id)

                # Pré-filtro barato: se extract_flat já trouxe duration > 60s
                dur_flat = entry.get("duration") or 0
                if dur_flat and dur_flat > MAX_DURATION:
                    descartados["longo_flat"] += 1
                    _safe_print(f"    - {vid_id}  {dur_flat}s  (longo, pulando)")
                    continue

                # Filtro de relevância ao tema: rejeita candidatos cujo
                # título não tenha NENHUM token do tema. Sem isso, a
                # /hashtag/<tema>/shorts pode devolver Shorts populares
                # genéricos (ex.: futebol quando tema é "league of legends").
                titulo_cand = entry.get("title", "") or ""
                if not _titulo_combina(titulo_cand, tokens):
                    descartados["off_topic"] += 1
                    _safe_print(f"    - {vid_id}  (off-topic: \"{titulo_cand[:50]}\")")
                    continue

                # Validação rígida: URL /shorts/ + duração ≤60s
                is_short, duracao, shorts_url = _validar_short(vid_id)
                if not is_short:
                    if duracao and duracao > MAX_DURATION:
                        descartados["duracao_invalida"] += 1
                        motivo = f"{duracao}s > {MAX_DURATION}s"
                    else:
                        descartados["nao_shorts"] += 1
                        motivo = "não é Short (URL /shorts/ não mantém)"
                    _safe_print(f"    - {vid_id}  ({motivo})")
                    continue

                resultados.append({
                    "url":      shorts_url,
                    "title":    entry.get("title", "Sem título"),
                    "duration": duracao,
                })
                blacklist.add(vid_id)
                salvar_na_blacklist(vid_id)
                _safe_print(f"    + {vid_id}  {duracao}s  {entry.get('title','')[:45]}")

                if len(resultados) >= quantidade:
                    break

            except Exception as e:
                _safe_print(f"    erro em {entry.get('id','?')}: {e}")
                continue

    _safe_print(
        f"Total encontrado: {len(resultados)} Shorts  "
        f"(descartes: já-usados={descartados['blacklist']}, "
        f"longos-flat={descartados['longo_flat']}, "
        f"off-topic={descartados['off_topic']}, "
        f"não-shorts={descartados['nao_shorts']}, "
        f"duração>60s={descartados['duracao_invalida']})"
    )
    return resultados[:quantidade]
