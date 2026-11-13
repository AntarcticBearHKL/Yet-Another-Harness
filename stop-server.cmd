@echo off
setlocal
set "PIDFILE=%APPDATA%\yah\server.pid"
if not exist "%PIDFILE%" (
  echo No server pid file at %PIDFILE%.
  exit /b 1
)
set /p PID=<"%PIDFILE%"
if not defined PID exit /b 1
taskkill /PID %PID% /F
del "%PIDFILE%" >nul 2>nul
