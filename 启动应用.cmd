@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or newer first.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 exit /b 1
)
if not exist dist\index.html (
  call npm run build
  if errorlevel 1 exit /b 1
)
echo Open http://localhost:3001 after the server starts.
echo Keep this window open to keep reminders running.
node --env-file-if-exists=.env server/index.mjs
pause
