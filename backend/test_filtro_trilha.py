"""
Testes do montador de filtro da trilha de fundo (_filtro_trilha).

Sem pytest de propósito: o projeto não tem infra de teste e não vale
adicionar dependência só por isso.

Rodar:  backend/venv/Scripts/python.exe backend/test_filtro_trilha.py
Sai com código 0 se tudo passar, 1 se algo falhar.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from video_processor import _filtro_trilha

FALHAS = []


def checa(nome, condicao, detalhe=""):
    if condicao:
        print(f"  ok    {nome}")
    else:
        print(f"  FALHA {nome} {detalhe}")
        FALHAS.append(nome)


# As duas strings abaixo sao EXATAMENTE o que o codigo produzia antes da
# refatoracao. Se mudarem, o comportamento dos modos existentes mudou.
ESPERADO_100 = (
    "[1:a]volume=1.0[mus];"
    "[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[final_a]"
)
ESPERADO_FIXO = (
    "[1:a]volume=0.12[mus];"
    "[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[final_a]"
)

print("modo 100_musica:")
checa("grafo identico ao original", _filtro_trilha("100_musica") == ESPERADO_100,
      f"\n    veio: {_filtro_trilha('100_musica')}")

print("modo 50_50:")
checa("grafo identico ao original", _filtro_trilha("50_50") == ESPERADO_FIXO,
      f"\n    veio: {_filtro_trilha('50_50')}")

print("modo desconhecido:")
checa("cai no comportamento do 50_50", _filtro_trilha("modo_que_nao_existe") == ESPERADO_FIXO,
      f"\n    veio: {_filtro_trilha('modo_que_nao_existe')}")
checa("string vazia cai no 50_50", _filtro_trilha("") == ESPERADO_FIXO)

print("modo ducking:")
g = _filtro_trilha("ducking")
checa("duplica o audio do clipe com asplit", "asplit=2" in g, f"\n    veio: {g}")
checa("filtra o gatilho na banda vocal grave", "highpass=f=200" in g)
checa("filtra o gatilho na banda vocal aguda", "lowpass=f=4000" in g)
checa("usa sidechaincompress", "sidechaincompress=" in g)
checa("musica entra no nivel base de ducking", "volume=0.5[mus]" in g)
checa("saida continua sendo [final_a]", g.endswith("[final_a]"))
checa("voz entra na mistura sem atenuacao", "[voz][mus_duck]amix" in g)
checa("nao vaza rotulo intermediario", g.count("[final_a]") == 1)

print("modos existentes seguem sem sidechain:")
checa("100_musica sem sidechain", "sidechaincompress" not in _filtro_trilha("100_musica"))
checa("50_50 sem sidechain", "sidechaincompress" not in _filtro_trilha("50_50"))

print()
if FALHAS:
    print(f"{len(FALHAS)} falha(s): {', '.join(FALHAS)}")
    sys.exit(1)
print("todos os testes passaram")
sys.exit(0)
