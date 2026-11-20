@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
echo ====================================================
echo Starting WebSocket Bot-to-Bot POC Dashboard...
echo Open http://localhost:4002 in your browser
echo ====================================================

:: Kill previous listeners on ports 4002, 5001, 5002
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4002 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5001 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5002 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1

:: Open browser after 2 seconds
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4002"

:: Run POC Bridge Server
node server_bridge.js
pause
