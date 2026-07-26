"""
Testes do filtro que silencia o log de acesso das rotas de polling.

O filtro le record.args no formato do uvicorn:
    (client_addr, metodo, caminho, versao_http, status)
Se esse formato mudar numa atualizacao do uvicorn, o teste "formato
inesperado" garante que a falha e barulho a mais, nunca perda de log.

Rodar:  backend/venv/Scripts/python.exe backend/test_filtro_log.py
"""
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import _FiltroLogPolling

FALHAS = []
filtro = _FiltroLogPolling()


def registro(args):
    r = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "%s - \"%s %s HTTP/%s\" %d", args, None)
    return r


def checa(nome, condicao, detalhe=""):
    if condicao:
        print(f"  ok    {nome}")
    else:
        print(f"  FALHA {nome} {detalhe}")
        FALHAS.append(nome)


C = "127.0.0.1:54424"

print("silencia o polling:")
checa("GET /api/ranking 200",
      filtro.filter(registro((C, "GET", "/api/ranking", "1.1", 200))) is False)
checa("GET /api/ranking/<id> 200",
      filtro.filter(registro((C, "GET", "/api/ranking/abc-123", "1.1", 200))) is False)
checa("GET /api/frame com querystring 200",
      filtro.filter(registro((C, "GET", "/api/frame?url=x&t=0.0", "1.1", 200))) is False)

print("mantem o que importa:")
checa("POST na mesma rota continua logado",
      filtro.filter(registro((C, "POST", "/api/ranking/abc/items/1", "1.1", 200))) is True)
checa("DELETE continua logado",
      filtro.filter(registro((C, "DELETE", "/api/ranking/abc", "1.1", 200))) is True)
checa("GET com erro 500 continua logado",
      filtro.filter(registro((C, "GET", "/api/ranking", "1.1", 500))) is True)
checa("GET com erro 404 continua logado",
      filtro.filter(registro((C, "GET", "/api/ranking/sumiu", "1.1", 404))) is True)
checa("outra rota continua logada",
      filtro.filter(registro((C, "GET", "/api/music", "1.1", 200))) is True)
checa("rota com prefixo parecido nao e silenciada por engano",
      filtro.filter(registro((C, "GET", "/api/rankings-outra-coisa", "1.1", 200))) is True)

print("falha segura:")
checa("formato inesperado deixa passar",
      filtro.filter(registro((C, "GET"))) is True)
checa("sem args deixa passar",
      filtro.filter(registro(None)) is True)

print()
if FALHAS:
    print(f"{len(FALHAS)} falha(s): {', '.join(FALHAS)}")
    sys.exit(1)
print("todos os testes passaram")
sys.exit(0)
