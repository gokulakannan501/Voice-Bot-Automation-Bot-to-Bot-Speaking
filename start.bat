@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
echo ====================================================
echo 🤖 Starting Voice Bot-to-Bot QA Studio...
echo 🌐 Open http://localhost:4002 in your browser
echo ====================================================
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :4002 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
node server_bridge.js
pause
