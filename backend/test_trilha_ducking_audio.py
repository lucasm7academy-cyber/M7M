"""
Teste comportamental do modo 'ducking': mede se a musica realmente recua
quando ha voz no clipe.

Monta clipes de 6s cujo audio simula voz em 0-2s e 4-6s, com silencio em
2-4s. A musica e um tom continuo numa frequencia distinta, para poder ser
medida isolada por bandpass.

  voz    = 1000 Hz  (dentro da banda 200-4000 Hz que o gatilho escuta)
  musica = 6000 Hz  (fora da banda do gatilho, medivel separadamente)

IMPORTANTE - por que os niveis de voz importam:
A primeira versao deste teste usava um tom em ESCALA CHEIA como voz. Isso
mede um cenario que nao existe: fala real vive entre -12 e -20 dB. O ajuste
que parecia certo naquela medicao dava duck praticamente zero na faixa real,
e a musica nao abaixava nos videos. Por isso agora medimos na faixa realista
e travamos tambem o caso da fala baixa.

Rodar:  backend/venv/Scripts/python.exe backend/test_trilha_ducking_audio.py
"""
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from video_processor import _filtro_trilha

FFMPEG = r"C:/Users/78787/Documents/ffmpeg/bin/ffmpeg"

# Fala normal (~-16 dB): tem que abaixar bem, sem sumir por completo.
NIVEL_FALA_NORMAL = 0.15
DUCK_NORMAL_MIN_DB = 12.0
DUCK_NORMAL_MAX_DB = 26.0

# Fala baixa (~-20 dB): o bug relatado pelo Lucas. Aqui o duck media 0.00 dB
# e a musica simplesmente nao abaixava. Guarda de regressao.
NIVEL_FALA_BAIXA = 0.1
DUCK_BAIXA_MIN_DB = 8.0

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
        raise SystemExit(f"ffmpeg falhou: {' '.join(cmd[:6])}...")


def medir(path, freq, inicio, dur):
    """mean_volume em dB da banda `freq`, na janela [inicio, inicio+dur]."""
    r = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-ss", str(inicio), "-t", str(dur),
         "-i", path, "-af", f"bandpass=f={freq}:w=200,volumedetect", "-f", "null", "-"],
        capture_output=True,
    )
    saida = r.stderr.decode("utf-8", errors="replace")
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", saida)
    if not m:
        raise SystemExit(f"nao consegui medir {path} @ {freq}Hz:\n{saida[-500:]}")
    return float(m.group(1))


tmp = tempfile.mkdtemp(prefix="duck_test_")
musica = os.path.join(tmp, "musica.mp3")

run([FFMPEG, "-y", "-loglevel", "error",
     "-f", "lavfi", "-i", "sine=frequency=6000:sample_rate=44100:duration=6",
     "-c:a", "libmp3lame", "-b:a", "192k", musica])


def duck_em(nivel_voz):
    """Quantos dB a musica recua entre a janela com voz e a janela muda."""
    clipe = os.path.join(tmp, f"clipe_{nivel_voz}.mp4")
    run([FFMPEG, "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=6",
         "-f", "lavfi", "-i",
         f"sine=frequency=1000:sample_rate=44100:duration=6,"
         f"volume='if(between(t,2,4),0,{nivel_voz})':eval=frame",
         "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100", "-shortest", clipe])

    saida = os.path.join(tmp, f"saida_{nivel_voz}.mp4")
    run([FFMPEG, "-y", "-loglevel", "error",
         "-i", clipe, "-stream_loop", "-1", "-i", musica,
         "-filter_complex", _filtro_trilha("ducking"),
         "-map", "0:v:0", "-map", "[final_a]",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
         "-t", "6.000", saida])

    com_voz = medir(saida, 6000, 0.5, 1.0)
    sem_voz = medir(saida, 6000, 2.5, 1.0)
    return sem_voz - com_voz


d_normal = duck_em(NIVEL_FALA_NORMAL)
d_baixa = duck_em(NIVEL_FALA_BAIXA)

print("=" * 62)
print(f"  duck com fala normal (~-16 dB):  {d_normal:7.2f} dB")
print(f"  duck com fala baixa   (~-20 dB): {d_baixa:7.2f} dB")
print("=" * 62)

print("fala normal:")
checa(f"abaixa o suficiente (>= {DUCK_NORMAL_MIN_DB} dB)", d_normal >= DUCK_NORMAL_MIN_DB,
      f"(mediu {d_normal:.2f} dB — suba a sensibilidade baixando TRILHA_DUCK_THRESHOLD)")
checa(f"nao some por completo (<= {DUCK_NORMAL_MAX_DB} dB)", d_normal <= DUCK_NORMAL_MAX_DB,
      f"(mediu {d_normal:.2f} dB — suba TRILHA_DUCK_THRESHOLD para suavizar)")

print("fala baixa (regressao do bug relatado):")
checa(f"ainda abaixa de forma audivel (>= {DUCK_BAIXA_MIN_DB} dB)", d_baixa >= DUCK_BAIXA_MIN_DB,
      f"(mediu {d_baixa:.2f} dB — era esse o bug: em item com fala baixa a musica nao abaixava)")

print()
if FALHAS:
    print(f"{len(FALHAS)} falha(s): {', '.join(FALHAS)}")
    sys.exit(1)
print("todos os testes passaram")
sys.exit(0)
