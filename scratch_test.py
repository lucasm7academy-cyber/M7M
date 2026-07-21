import asyncio
import os
import sys

# Insert backend to python path so it can import configuration correctly
sys.path.insert(0, r'C:\Users\78787\Documents\moviepy\backend')
import video_processor

async def test():
    item = {
        'url': 'https://www.youtube.com/shorts/35FmGFRU14w', 
        'title': 'Teste Som 80-20', 
        'video_y': 0, 
        'overlay': '1', 
        'font': 'Oswald-Bold', 
        'title_y': 510, 
        'filtro': 'Nenhum', 
        'cor_titulo': 'Amarelo', 
        'titulo_borda': True, 
        'tarja': {'usar': False, 'cor': 'Preto', 'pos_y': 1500, 'height': 200, 'opacity': 0.8}, 
        'narrar_titulo': False, 
        'travar_inicio': False, 
        'narrations': [], 
        'gerar_legenda': False, 
        'estilo_legenda': 'AMARELO_CLASSICO', 
        'voice': 'padrao',
        'musica_fundo': 'Montagem_Alquimia.mp3',
        'musica_modo': '50_50',  # mixed mode: original sound at 2.0, music at 0.25
    }
    
    async def emit(e):
        print(f"[EMIT] {e}")
        
    print("Iniciando processamento do vídeo com música (modo mixed, original=2.0, música=25%)...")
    res = await video_processor.processar_video(item, 0, emit)
    print(f"Resultado do processamento: {res}")

if __name__ == "__main__":
    asyncio.run(test())
