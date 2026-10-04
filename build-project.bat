@echo off
chcp 65001 >nul
title aiGameGongfang Studio - Build
echo ========================================
echo   aiGameGongfang Studio Project Build
echo ========================================
echo.
echo Building project...
echo.

cd /d "%~dp0"

call npm run build

echo.
echo ========================================
echo   Build completed!
echo ========================================
echo.

pause
