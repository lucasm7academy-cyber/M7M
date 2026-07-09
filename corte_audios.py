import os
import json
from pydub import AudioSegment
from pydub.silence import split_on_silence

mp3_path = r"C:\Users\78787\Downloads\MiniMax_2026-07-08_17_01_35_sett.mp3"
txt_path = "textos_para_gerar_audio.txt"
output_dir = "backend/assets/preset_audios"
os.makedirs(output_dir, exist_ok=True)

print("Carregando audio...")
sound = AudioSegment.from_mp3(mp3_path)
print("Aumentando o volume em +2dB...")
sound = sound + 2

print("Lendo textos...")
with open(txt_path, "r", encoding="utf-8") as f:
    textos = [linha.strip() for linha in f if linha.strip()]

print("Separando audio...")
chunks = split_on_silence(sound, 
    min_silence_len=500, 
    silence_thresh=sound.dBFS - 16,
    keep_silence=200 
)

print(f"Encontrados {len(chunks)} chunks.")

if len(chunks) == 101:
    print("Mesclando chunks 6 e 7 ('Não pisca' e 'senão você perde')...")
    # Mescla o chunk 6 e 7 com um pouco de silêncio no meio, ou diretamente.
    # keep_silence já manteve o silêncio nas bordas, então podemos apenas concatenar.
    merged_chunk = chunks[6] + chunks[7]
    
    # Cria uma nova lista com o chunk mesclado e remove o chunk 7
    new_chunks = chunks[:6] + [merged_chunk] + chunks[8:]
    chunks = new_chunks
    print(f"Agora temos {len(chunks)} chunks.")

if len(chunks) == len(textos):
    print("Salvando...")
    mapa = {}
    for i, (chunk, texto) in enumerate(zip(chunks, textos)):
        filename = f"preset_{i:03d}.mp3"
        out_path = os.path.join(output_dir, filename)
        chunk.export(out_path, format="mp3")
        mapa[texto] = f"assets/preset_audios/{filename}"
        
    with open(os.path.join(output_dir, "mapa_audios.json"), "w", encoding="utf-8") as f:
        json.dump(mapa, f, ensure_ascii=False, indent=2)
    print("Concluído com sucesso!")
else:
    print(f"Erro: Temos {len(chunks)} chunks, esperávamos {len(textos)}.")
