import os
import glob
import shutil
import subprocess
import tempfile

MUSIC_DIR = r"c:\Users\78787\Documents\moviepy\music"
os.makedirs(MUSIC_DIR, exist_ok=True)

# Path to executables
YTDLP_CMD = r"C:\Users\78787\AppData\Local\Programs\Python\Python310\Scripts\yt-dlp.exe"
FFMPEG_CMD = r"C:\Users\78787\Documents\ffmpeg\bin\ffmpeg.exe"
if not os.path.exists(YTDLP_CMD):
    YTDLP_CMD = "yt-dlp"
if not os.path.exists(FFMPEG_CMD):
    FFMPEG_CMD = "ffmpeg"

new_tracks = [
    {"url": "https://www.youtube.com/watch?v=pytdWKT-NV4", "name": "LXNGVX_Warriyo_Mortals_Funk_Remix.mp3", "start": 26},
    {"url": "https://www.youtube.com/watch?v=eBaGlo1b3ZY", "name": "MXZI_Montagem_Toma.mp3", "start": 0},
    {"url": "https://www.youtube.com/watch?v=ywwTbMd_scc", "name": "RAIZHELL_Faster.mp3", "start": 72},
    {"url": "https://www.youtube.com/watch?v=ngeEIRN-TRU", "name": "DR_MOB_Fearless_Funk.mp3", "start": 0},
    {"url": "https://www.youtube.com/watch?v=WhvygG1jVzM", "name": "ANGELPLAYA_Let_Them_Have_It.mp3", "start": 10},
    {"url": "https://www.youtube.com/watch?v=GCPMx3L6zHE", "name": "ANGELPLAYA_TMass_Favhella.mp3", "start": 0},
    {"url": "https://www.youtube.com/watch?v=CZmAZa2e1D4", "name": "TWISTED_Bussin.mp3", "start": 0},
    {"url": "https://www.youtube.com/watch?v=3GdBNU-eshA", "name": "Infraction_Phonk_Brazilian_Sport_Cyberpunk.mp3", "start": 12},
]

def main():
    print("=== Limpando músicas antigas da pasta music ===")
    existing_files = glob.glob(os.path.join(MUSIC_DIR, "*.*"))
    new_names = {t["name"] for t in new_tracks}
    
    for f in existing_files:
        filename = os.path.basename(f)
        if filename not in new_names:
            print(f"[REMOVENDO] Múscia antiga: {filename}")
            try:
                os.remove(f)
            except Exception as e:
                print(f"[ERRO ao remover {filename}]: {e}")

    print("\n=== Baixando e Cortando Novas Músicas ===")
    for t in new_tracks:
        final_path = os.path.join(MUSIC_DIR, t["name"])
        print(f"\n[PROCESSANDO] {t['name']} (Início em {t['start']}s)...")
        
        tmp_dir = tempfile.mkdtemp()
        try:
            out_template = os.path.join(tmp_dir, "audio.%(ext)s")
            cmd_dl = [
                YTDLP_CMD, "--no-playlist", "-x", "--audio-format", "mp3",
                "--audio-quality", "0",
                "-o", out_template,
                t["url"]
            ]
            
            res = subprocess.run(cmd_dl, capture_output=True, text=True)
            downloaded_mp3 = os.path.join(tmp_dir, "audio.mp3")
            
            if not os.path.exists(downloaded_mp3):
                files_in_tmp = os.listdir(tmp_dir)
                if files_in_tmp:
                    downloaded_mp3 = os.path.join(tmp_dir, files_in_tmp[0])
                else:
                    print(f"[ERRO] Falha ao baixar {t['name']}: {res.stderr[:300]}")
                    continue
            
            if t["start"] > 0:
                print(f"[CORTANDO] {t['name']} iniciando no segundo {t['start']}...")
                cmd_cut = [
                    FFMPEG_CMD, "-y", "-loglevel", "error",
                    "-ss", str(t["start"]),
                    "-i", downloaded_mp3,
                    "-c:a", "libmp3lame", "-b:a", "192k",
                    final_path
                ]
                res_cut = subprocess.run(cmd_cut, capture_output=True, text=True)
                if res_cut.returncode != 0:
                    print(f"[ERRO ffmpeg]: {res_cut.stderr[:300]}")
            else:
                if os.path.exists(final_path):
                    os.unlink(final_path)
                shutil.move(downloaded_mp3, final_path)
                
            if os.path.exists(final_path):
                print(f"[SUCESSO] {t['name']} baixada e salva com sucesso!")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    print("\n=== Processamento Concluído! ===")

if __name__ == "__main__":
    main()


