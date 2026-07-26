"""
Teste comportamental do modo 'ducking': mede se a musica realmente recua
quando ha voz no clipe.

Monta um clipe de 6s cujo audio simula voz em 0-2s e 4-6s, com silencio
em 2-4s. A musica e um tom continuo numa frequencia distinta, para poder
ser medida isolada por bandpass.

  voz    = 1000 Hz  (dentro da banda 200-4000 Hz que o gatilho escuta)
  musica = 6000 Hz  (fora da banda do gatilho, medivel separadamente)

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

# Alvo: musica 0.5 sem voz, 0.12 com voz -> 20*log10(0.5/0.12) ~= 12.4 dB
DELTA_MIN_DB = 9.0
DELTA_MAX_DB = 16.0


def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        print(r.stderr.decode("utf-8", errors="replace")[-800:])
        raise SystemExit(f"ffmpeg falhou: {' '.join(cmd[:6])}...")
    return r


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
clipe = os.path.join(tmp, "clipe.mp4")
musica = os.path.join(tmp, "musica.mp3")
saida = os.path.join(tmp, "saida.mp4")

# Clipe: video azul + "voz" em 0-2s e 4-6s (1000 Hz ligado/desligado)
run([FFMPEG, "-y", "-loglevel", "error",
     "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=6",
     "-f", "lavfi", "-i",
     "sine=frequency=1000:sample_rate=44100:duration=6,"
     "volume='if(between(t,2,4),0,1)':eval=frame",
     "-c:v", "libx264", "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100", "-shortest", clipe])

# Musica: tom continuo de 6000 Hz
run([FFMPEG, "-y", "-loglevel", "error",
     "-f", "lavfi", "-i", "sine=frequency=6000:sample_rate=44100:duration=6",
     "-c:a", "libmp3lame", "-b:a", "192k", musica])

# Aplica o modo ducking com o MESMO grafo que o pipeline usa
run([FFMPEG, "-y", "-loglevel", "error",
     "-i", clipe, "-stream_loop", "-1", "-i", musica,
     "-filter_complex", _filtro_trilha("ducking"),
     "-map", "0:v:0", "-map", "[final_a]",
     "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
     "-t", "6.000", saida])

com_voz = medir(saida, 6000, 0.5, 1.0)    # janela com voz -> musica deve recuar
sem_voz = medir(saida, 6000, 2.5, 1.0)    # janela muda    -> musica deve subir
delta = sem_voz - com_voz

print("=" * 62)
print(f"  musica COM voz (0.5-1.5s):  {com_voz:7.2f} dB")
print(f"  musica SEM voz (2.5-3.5s):  {sem_voz:7.2f} dB")
print(f"  diferenca (o duck):         {delta:7.2f} dB")
print(f"  alvo: entre {DELTA_MIN_DB} e {DELTA_MAX_DB} dB")
print("=" * 62)

if delta < DELTA_MIN_DB:
    print("\nFALHOU: duck fraco demais - a musica quase nao recua na fala.")
    print("  Ajuste: AUMENTE TRILHA_DUCK_RATIO e/ou DIMINUA TRILHA_DUCK_THRESHOLD")
    sys.exit(1)
if delta > DELTA_MAX_DB:
    print("\nFALHOU: duck forte demais - a musica some na fala.")
    print("  Ajuste: DIMINUA TRILHA_DUCK_RATIO e/ou AUMENTE TRILHA_DUCK_THRESHOLD")
    sys.exit(1)

print("\nPASSOU: o ducking esta dentro do alvo.")
sys.exit(0)
