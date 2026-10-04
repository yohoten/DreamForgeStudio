@echo off
chcp 65001 >nul
title aiGameGongfang Studio - Setup
echo ========================================
echo   aiGameGongfang Studio Environment Setup
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)
echo OK: Node.js installed

echo.
echo [2/3] Checking dependencies...
if not exist "node_modules\" (
    echo WARNING: node_modules not found. Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo ERROR: Dependency installation failed.
        pause
        exit /b 1
    )
    echo OK: Dependencies installed.
) else (
    echo OK: Dependencies already exist.
)

echo.
echo [3/3] Checking .env configuration...
if not exist ".env" (
    echo WARNING: .env file not found.
    if exist ".env.example" (
        echo Creating .env from .env.example...
        copy .env.example .env >nul
        echo OK: .env file created. Please edit it to configure environment variables.
    ) else (
        echo ERROR: .env.example template not found.
    )
) else (
    echo OK: .env configuration exists.
)

echo.
echo ========================================
echo   Environment setup completed!
echo ========================================
echo.
echo Tip: Make sure to configure required environment variables in .env file.
echo.

pause
