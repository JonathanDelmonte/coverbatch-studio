@echo off
cd /d "%~dp0"
node --version
if not exist node_modules (
  echo Execute npm ci nesta pasta antes de iniciar.
  pause
  exit /b 1
)
start "" http://127.0.0.1:4317
npm start
