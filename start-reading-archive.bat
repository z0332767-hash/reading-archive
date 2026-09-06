@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Reading Archive requires Node.js 20 or newer.
  echo Download it from https://nodejs.org/
  pause
  exit /b 1
)
start "Reading Archive Server" cmd /c "node server.mjs"
timeout /t 1 /nobreak >nul
start "" "http://localhost:4173"
echo Reading Archive is running at http://localhost:4173
echo Close the server window when you finish.
pause
