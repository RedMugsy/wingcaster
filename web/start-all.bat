@echo off
cd /d "C:\Users\AliAchkar\Documents\kimi\workspace\souq-ajjar-realestate"
echo Starting backend...
start /min cmd /c "node backend/src/server.js"
echo Starting frontend preview...
start /min cmd /c "python preview.py"
echo Servers started. Press any key to exit this window.
pause >nul
