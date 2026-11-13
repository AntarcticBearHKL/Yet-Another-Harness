@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0cloudflared.exe" (
  echo Put cloudflared.exe next to this file, or replace this script with your frp/ngrok command.
  echo Tunnel target: http://127.0.0.1:3790
  exit /b 1
)

"%~dp0cloudflared.exe" tunnel --url http://127.0.0.1:3790
