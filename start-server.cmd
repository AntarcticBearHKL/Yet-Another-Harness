@echo off
setlocal
cd /d "%~dp0"

rem Optional portable data directory (otherwise %APPDATA%\yah):
rem set YAH_DATA_DIR=%~dp0data

rem Set this here if you do not want to set it in the shell every time:
rem set YAH_REMOTE_PASSWORD=change-this-password

if not defined YAH_REMOTE_PASSWORD (
  echo YAH_REMOTE_PASSWORD is not set.
  echo Example:
  echo   set YAH_REMOTE_PASSWORD=your-password
  echo   start-server.cmd
  exit /b 1
)

set ELECTRON_RUN_AS_NODE=1
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0server\index.js"
