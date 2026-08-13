@echo off
cd /d "C:\Users\AliAchkar\Documents\kimi\workspace\souq-ajjar-realestate"
if exist preview.js move /Y preview.js preview.cjs >nul 2>&1
start /min node preview.cjs
