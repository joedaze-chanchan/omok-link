@echo off
title Omok server - do not close this window
cd /d "%~dp0"
if not exist node_modules (
  echo [setup] installing packages...
  call npm install --no-audit --no-fund
)
echo.
echo ==============================================
echo   OMOK SERVER  -  http://localhost:3000
echo   Keep this window open while playing.
echo   If the server stops, it restarts in 3 sec.
echo   Log: data\server.log
echo ==============================================
echo.
:loop
node server.js
echo.
echo [server stopped - restarting in 3 sec]
timeout /t 3 /nobreak >nul
goto loop
