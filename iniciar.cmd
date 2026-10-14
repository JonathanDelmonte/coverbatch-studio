@echo off
cd /d "%~dp0"
title CoverBatch Studio
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Para usar sem instalar Node.js, baixe o pacote Windows na pagina de releases.
  echo https://github.com/ZIRTUNO/coverbatch-studio/releases/latest
  pause
  exit /b 1
)
if not exist node_modules (
  echo Execute npm ci nesta pasta antes de iniciar.
  pause
  exit /b 1
)
node scripts\launcher.js
if errorlevel 1 pause
