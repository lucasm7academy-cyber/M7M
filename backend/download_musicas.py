import os
import subprocess
import tempfile

MUSIC_DIR = r"c:\Users\78787\Documents\moviepy\music"
os.makedirs(MUSIC_DIR, exist_ok=True)

tracks = [
    {"url": "https://www.youtube.com/watch?v=4E4VaL5krv8", "name": "Montagem_Pegadora_Slowed.mp3", "start": 0},
    {"url": "https://www.youtube.com/watch?v=qai2Qx_vduA", "name": "Funk_Sigilo_Slowed.mp3", "start": 0},
    {"url": "https://www.youtube.com/watch?v=-QOByC7hxRo", "name": "Montagem_Monarca.mp3", "start": 0},
    {"url": "https://www.youtube.com/watch?v=zHm8GFK0m-E", "name": "Montagem_Alquimia.mp3", "start": 9},
    {"url": "https://www.youtube.com/watch?v=1l7WMMIkKWY", "name": "Funk_Tropical_Slowed.mp3", "start": 11},
    {"url": "https://www.youtube.com/watch?v=53SyywtK0XU", "name": "Funk_Secreto_Ultraslowed.mp3", "start": 0},
    {"url": "https://www.youtube.com/watch?v=xmRVFNv_DGs", "name": "Funk_Oscuro_Superslowed.mp3", "start": 0},
]

for t in tracks:
    final_path = os.path.join(MUSIC_DIR, t["name"])
    if os.path.exists(final_path):
        print(f"[OK] Já existe: {t['name']}")
        continue
    
    print(f"[BAIXANDO] {t['name']} de {t['url']}...")
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp_path = tmp.name
    
    cmd_dl = [
        "yt-dlp", "-x", "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", tmp_path,
        t["url"]
    ]
    
    res = subprocess.run(cmd_dl, capture_output=True, text=True)
    actual_tmp = tmp_path
    if not os.path.exists(actual_tmp) and os.path.exists(actual_tmp + ".mp3"):
        actual_tmp = actual_tmp + ".mp3"
        
    if not os.path.exists(actual_tmp):
        print(f"[ERRO] Falha ao baixar {t['name']}: {res.stderr[:200]}")
        continue
        
    if t["start"] > 0:
        print(f"[CORTANDO] {t['name']} iniciando em {t['start']}s...")
        cmd_cut = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", str(t["start"]),
            "-i", actual_tmp,
            "-c:a", "libmp3lame", "-b:a", "192k",
            final_path
        ]
        subprocess.run(cmd_cut)
        try: os.unlink(actual_tmp)
        except OSError: pass
    else:
        if os.path.exists(final_path): os.unlink(final_path)
        os.replace(actual_tmp, final_path)
        
    print(f"[SUCESSO] {t['name']} pronto!")

print("Todas as músicas virais processadas!")
