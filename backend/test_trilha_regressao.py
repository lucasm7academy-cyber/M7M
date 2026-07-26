"""
Regressao dos tres modos de trilha, ponta a ponta com ffmpeg de verdade.

Usa um clipe com "audio original" em 440 Hz e uma musica em 6000 Hz, e
confere para cada modo se cada um dos dois sinais esta presente ou ausente
na saida.

Rodar:  backend/venv/Scripts/python.exe backend/test_trilha_regressao.py
"""
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from video_processor import _filtro_trilha

FFMPEG = r"C:/Users/78787/Documents/ffmpeg/bin/ffmpeg"

# Abaixo disso consideramos o sinal ausente. Silencio digital mede ~-91 dB;
# vazamento do bandpass a partir de um tom forte fica na casa dos -50 dB.
LIMIAR_AUSENTE_DB = -45.0

FALHAS = []


def checa(nome, condicao, detalhe=""):
    if condicao:
        print(f"  ok    {nome}")
    else:
        print(f"  FALHA {nome} {detalhe}")
        FALHAS.append(nome)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        print(r.stderr.decode("utf-8", errors="replace")[-800:])
        raise SystemExit("ffmpeg falhou")


def medir(path, freq, inicio=None, dur=None):
    janela = ["-ss", str(inicio), "-t", str(dur)] if inicio is not None else []
    r = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", *janela, "-i", path,
         "-af", f"bandpass=f={freq}:w=200,volumedetect", "-f", "null", "-"],
        capture_output=True,
    )
    saida = r.stderr.decode("utf-8", errors="replace")
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", saida)
    if not m:
        raise SystemExit(f"nao consegui medir {path} @ {freq}Hz")
    return float(m.group(1))


tmp = tempfile.mkdtemp(prefix="trilha_reg_")
musica = os.path.join(tmp, "musica.mp3")

run([FFMPEG, "-y", "-loglevel", "error",
     "-f", "lavfi", "-i", "sine=frequency=6000:sample_rate=44100:duration=6",
     "-c:a", "libmp3lame", "-b:a", "192k", musica])


def clipe_para(modo):
    """
    Clipe de 6s com som em 0-2s e 4-6s e silencio em 2-4s.

    A pausa existe porque o modo ducking so deixa a musica subir quando o
    clipe se cala. Medir a musica no arquivo inteiro medaria justamente o
    trecho em que ela DEVE estar abaixada - e daria falso negativo.

    No 100_musica o audio ja vem mudo, como o pipeline faz no item.
    """
    path = os.path.join(tmp, f"clipe_{modo}.mp4")
    if modo == "100_musica":
        audio = ["-f", "lavfi", "-t", "6", "-i", "anullsrc=r=44100:cl=stereo"]
    else:
        audio = ["-f", "lavfi", "-i",
                 "sine=frequency=440:sample_rate=44100:duration=6,"
                 "volume='if(between(t,2,4),0,1)':eval=frame"]
    run([FFMPEG, "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=6", *audio,
         "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100", "-shortest", path])
    return path


for modo in ["50_50", "ducking", "100_musica"]:
    clipe = clipe_para(modo)
    saida = os.path.join(tmp, f"saida_{modo}.mp4")
    run([FFMPEG, "-y", "-loglevel", "error",
         "-i", clipe, "-stream_loop", "-1", "-i", musica,
         "-filter_complex", _filtro_trilha(modo),
         "-map", "0:v:0", "-map", "[final_a]",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
         "-t", "6.000", saida])

    # Original medido onde ele toca; musica medida na pausa, onde ela deve subir.
    orig = medir(saida, 440, 0.5, 1.0)
    mus = medir(saida, 6000, 2.5, 1.0)
    print(f"modo {modo}:  original(440Hz)={orig:7.2f} dB   musica na pausa(6000Hz)={mus:7.2f} dB")

    if modo == "100_musica":
        checa("100_musica descarta o audio original", orig < LIMIAR_AUSENTE_DB,
              f"(mediu {orig:.2f} dB, esperado < {LIMIAR_AUSENTE_DB})")
        checa("100_musica mantem a musica", mus > LIMIAR_AUSENTE_DB)
    else:
        checa(f"{modo} preserva o audio original", orig > LIMIAR_AUSENTE_DB,
              f"(mediu {orig:.2f} dB, esperado > {LIMIAR_AUSENTE_DB})")
        checa(f"{modo} mantem a musica na pausa", mus > LIMIAR_AUSENTE_DB,
              f"(mediu {mus:.2f} dB, esperado > {LIMIAR_AUSENTE_DB})")

    if modo == "ducking":
        # O que separa o ducking do 50_50: a musica tem que variar entre o
        # trecho com som e a pausa. Sem isso ele virou um nivel fixo.
        mus_com_som = medir(saida, 6000, 0.5, 1.0)
        checa("ducking realmente varia entre som e pausa",
              (mus - mus_com_som) >= 8.0,
              f"(diferenca de {mus - mus_com_som:.2f} dB, esperado >= 8.0)")

print()
if FALHAS:
    print(f"{len(FALHAS)} falha(s): {', '.join(FALHAS)}")
    sys.exit(1)
print("todos os modos passaram na regressao")
sys.exit(0)
