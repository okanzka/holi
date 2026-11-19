@echo off
title Heybe - public link
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b)

rem find cloudflared: on PATH, or where winget installs it
set "CF=cloudflared"
where cloudflared >nul 2>nul && goto found
set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if exist "%CF%" goto found
set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if exist "%CF%" goto found
echo cloudflared is not installed. Install it with:
echo   winget install --id Cloudflare.cloudflared -e
pause
exit /b

:found
rem the site server runs in its own window; close that window to stop it
start "Heybe server" node server.js
echo.
echo  Opening a public link to http://localhost:8080 ...
echo  Look below for the https://....trycloudflare.com address and share it.
echo  The address changes every time. Close this window to stop sharing.
echo.
"%CF%" tunnel --url http://localhost:8080
pause
