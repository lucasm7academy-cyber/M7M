"""
Testes do sorteio do efeito sonoro de transicao do ranking.

Rodar:  backend/venv/Scripts/python.exe backend/test_transicao_sfx.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import RANKING_TRANSICAO_SFX_POOL, SFX_DIR

FALHAS = []


def checa(nome, condicao, detalhe=""):
    if condicao:
        print(f"  ok    {nome}")
    else:
        print(f"  FALHA {nome} {detalhe}")
        FALHAS.append(nome)


print("composicao do pool:")
checa("notificacao fora do pool", "notificacao" not in RANKING_TRANSICAO_SFX_POOL)
checa("cta_segue_nois fora do pool (e locucao, nao efeito)",
      "cta_segue_nois" not in RANKING_TRANSICAO_SFX_POOL)
checa("pool tem pelo menos 2 opcoes (senao nao alterna)",
      len(RANKING_TRANSICAO_SFX_POOL) >= 2, f"(tem {len(RANKING_TRANSICAO_SFX_POOL)})")
checa("sem duplicatas no pool",
      len(RANKING_TRANSICAO_SFX_POOL) == len(set(RANKING_TRANSICAO_SFX_POOL)))

print("cada som do pool existe em disco:")
# Mesma busca por extensao que ranking_processor.py faz ao montar o item.
for som in RANKING_TRANSICAO_SFX_POOL:
    achou = any(
        os.path.exists(os.path.join(SFX_DIR, f"{som}{ext}"))
        for ext in (".mp3", ".wav", ".MP3", ".WAV")
    )
    checa(f"'{som}' resolve para um arquivo", achou, f"(procurei em {SFX_DIR})")

print("sorteio na criacao do ranking:")
from main import criar_ranking, CreateRankingRequest

vistos = set()
todos_do_pool = True
for _ in range(20):
    rk = criar_ranking(CreateRankingRequest(titulo_geral="teste", quantidade=5))
    for item in rk["itens"]:
        sfx = item["transicao_sfx"]
        vistos.add(sfx)
        if sfx not in RANKING_TRANSICAO_SFX_POOL:
            todos_do_pool = False
    if rk["transicao_sfx"] not in RANKING_TRANSICAO_SFX_POOL:
        todos_do_pool = False

checa("todo item sorteado saiu do pool", todos_do_pool, f"(vistos: {sorted(vistos)})")
checa("o sorteio realmente varia (nao ficou preso num som)",
      len(vistos) == len(RANKING_TRANSICAO_SFX_POOL),
      f"(esperava {sorted(RANKING_TRANSICAO_SFX_POOL)}, vi {sorted(vistos)})")

print()
if FALHAS:
    print(f"{len(FALHAS)} falha(s): {', '.join(FALHAS)}")
    sys.exit(1)
print("todos os testes passaram")
sys.exit(0)
