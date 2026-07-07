@echo off
chcp 65001 >nul
title Iniciar App de Video + Voz
echo ============================================
echo  Subindo os 3 servicos. NAO feche as janelas
echo  pretas que vao abrir (elas sao os servidores).
echo ============================================
echo.

REM Backend de video (porta 8090)
start "Backend Video (8090)" cmd /k "cd /d C:\Users\78787\Documents\moviepy\backend && python main.py"

REM Servidor de voz XTTS (porta 8095)
start "Voz XTTS (8095)" cmd /k "cd /d C:\Users\78787\Documents\voz_ai && venv\Scripts\python.exe voice_server.py"

REM Frontend (porta 5174)
start "Frontend (5174)" cmd /k "cd /d C:\Users\78787\Documents\moviepy\frontend && npm run dev"

echo Aguardando os servidores subirem (15s) e abrindo o navegador...
timeout /t 15 >nul
start "" "http://localhost:5174/"

echo.
echo Pronto! Se o navegador mostrar "conexao recusada",
echo espere mais alguns segundos e atualize a pagina (F5).
echo Voce pode fechar ESTA janela; as outras 3 devem ficar abertas.
pause
