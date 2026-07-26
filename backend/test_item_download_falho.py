"""
Quando o download do trecho falha, montar_item tem que desistir limpo.

Antes: baixar_trecho devolvia None, ninguem interrompia, e o None seguia
para os argumentos do ffmpeg. O subprocess estourava
"TypeError: expected str, bytes or os.PathLike object, not NoneType",
escondendo a causa real (link inacessivel, bloqueio do YouTube, etc).

Rodar:  backend/venv/Scripts/python.exe backend/test_item_download_falho.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ranking_processor as rp

FALHAS = []


def checa(nome, condicao, detalhe=""):
    if condicao:
        print(f"  ok    {nome}")
    else:
        print(f"  FALHA {nome} {detalhe}")
        FALHAS.append(nome)


RANKING = {"titulo_geral": "teste", "trilha_modo": "50_50"}
ITEM = {"link": "https://www.youtube.com/watch?v=xxxxxxxxxxx",
        "trim_inicio_s": 0.0, "trim_fim_s": 10.0, "titulo_item": "item de teste"}

original = rp.baixar_trecho
rp.baixar_trecho = lambda *a, **k: None   # simula download que falhou
try:
    erro = None
    resultado = "nao rodou"
    try:
        resultado = rp.montar_item(RANKING, dict(ITEM), 1, 0, lambda ev: None)
    except Exception as e:
        erro = e

    print("download falhando:")
    checa("nao levanta excecao", erro is None,
          f"\n    levantou: {type(erro).__name__}: {erro}")
    checa("devolve None para o orquestrador tratar", resultado is None,
          f"\n    devolveu: {resultado!r}")
finally:
    rp.baixar_trecho = original

print()
if FALHAS:
    print(f"{len(FALHAS)} falha(s): {', '.join(FALHAS)}")
    sys.exit(1)
print("todos os testes passaram")
sys.exit(0)
