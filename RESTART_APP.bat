@echo off
chcp 65001 >nul
title Restart App de Video + Voz

echo ============================================
echo  Encerrando servidores existentes...
echo ============================================

REM Mata as janelas dos servidores pelo titulo
taskkill /FI "WINDOWTITLE eq Backend Video*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Voz XTTS*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend*" /F >nul 2>&1

REM Garantia extra: mata processos nas portas
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8090') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8095') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5174') do taskkill /PID %%a /F >nul 2>&1

timeout /t 2 >nul

echo ============================================
echo  Iniciando servidores novamente...
echo ============================================

REM Backend de video (porta 8090)
start "Backend Video (8090)" cmd /k "cd /d C:\Users\78787\Documents\moviepy\backend && python main.py"

REM Servidor de voz XTTS (porta 8095)
start "Voz XTTS (8095)" cmd /k "cd /d C:\Users\78787\Documents\voz_ai && venv\Scripts\python.exe voice_server.py"

REM Frontend (porta 5174)
start "Frontend (5174)" cmd /k "cd /d C:\Users\78787\Documents\moviepy\frontend && npm run dev"

echo.
echo Servidores reiniciados!

echo.
echo Voce pode fechar ESTA janela; as outras 3 devem ficar abertas.
pause
