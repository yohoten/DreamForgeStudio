@echo off
chcp 65001 >nul
title aiGameGongfang Studio - Main Menu
setlocal enabledelayedexpansion

:menu
cls
echo ========================================
echo   aiGameGongfang Studio Control Panel
echo ========================================
echo.
echo   [1] Setup Environment (First time only)
echo   [2] Start Development Mode (Server + Web)
echo   [3] Start Backend Server Only
echo   [4] Start Frontend Web UI Only
echo   [5] Build Project
echo   [6] Run E2E Smoke Test
echo   [7] Check Environment Status
echo   [8] Clean node_modules
echo   [9] Update Dependencies
echo   [0] Exit
echo.
echo ========================================
echo.

choice /C 1234567890 /M "Please select an option"

if errorlevel 10 goto exit
if errorlevel 9 goto update_deps
if errorlevel 8 goto clean_modules
if errorlevel 7 goto check_status
if errorlevel 6 goto e2e_test
if errorlevel 5 goto build_project
if errorlevel 4 goto start_web
if errorlevel 3 goto start_server
if errorlevel 2 goto start_dev
if errorlevel 1 goto setup_env

goto menu

:setup_env
cls
echo ========================================
echo   Setting Up Environment
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Please install Node.js first.
    pause
    goto menu
)
echo OK: Node.js installed - Version: 
node --version

echo.
echo [2/3] Checking dependencies...
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo ERROR: Dependency installation failed.
        pause
        goto menu
    )
    echo OK: Dependencies installed.
) else (
    echo OK: Dependencies already exist.
)

echo.
echo [3/3] Checking .env configuration...
if not exist ".env" (
    if exist ".env.example" (
        echo Creating .env from .env.example...
        copy .env.example .env >nul
        echo OK: .env file created.
        echo TIP: Please edit .env to configure your environment variables.
    ) else (
        echo WARNING: Neither .env nor .env.example found.
    )
) else (
    echo OK: .env configuration exists.
)

echo.
echo ========================================
echo   Setup completed successfully!
echo ========================================
pause
goto menu

:start_dev
cls
echo ========================================
echo   Starting Development Mode
echo   (Backend Server + Frontend Web UI)
echo ========================================
echo.
echo This will start both server and web applications.
echo Press Ctrl+C to stop.
echo.

cd /d "%~dp0"
call npm run dev
goto menu

:start_server
cls
echo ========================================
echo   Starting Backend Server
echo ========================================
echo.
echo Starting backend server only...
echo Press Ctrl+C to stop.
echo.

cd /d "%~dp0"
call npm run dev:server
goto menu

:start_web
cls
echo ========================================
echo   Starting Frontend Web UI
echo ========================================
echo.
echo Starting frontend web interface only...
echo Press Ctrl+C to stop.
echo.

cd /d "%~dp0"
call npm run dev:web
goto menu

:build_project
cls
echo ========================================
echo   Building Project
echo ========================================
echo.
echo This may take a few minutes...
echo.

cd /d "%~dp0"
call npm run build

if errorlevel 1 (
    echo.
    echo ERROR: Build failed!
) else (
    echo.
    echo ========================================
    echo   Build completed successfully!
    echo ========================================
)
pause
goto menu

:e2e_test
cls
echo ========================================
echo   Running E2E Smoke Test
echo ========================================
echo.

cd /d "%~dp0"
call npm run check:studio-e2e

if errorlevel 1 (
    echo.
    echo ERROR: E2E test failed!
) else (
    echo.
    echo ========================================
    echo   E2E test passed!
    echo ========================================
)
pause
goto menu

:check_status
cls
echo ========================================
echo   Environment Status Check
echo ========================================
echo.

cd /d "%~dp0"

echo Node.js Version:
node --version 2>nul || echo NOT INSTALLED
echo.

echo npm Version:
npm --version 2>nul || echo NOT INSTALLED
echo.

echo Dependencies:
if exist "node_modules\" (
    echo INSTALLED
) else (
    echo NOT INSTALLED
)
echo.

echo Configuration Files:
if exist ".env" (
    echo .env: EXISTS
) else (
    echo .env: MISSING
)

if exist ".env.example" (
    echo .env.example: EXISTS
) else (
    echo .env.example: MISSING
)
echo.

echo Workspace Structure:
if exist "apps\studio-server" (
    echo apps/studio-server: EXISTS
) else (
    echo apps/studio-server: MISSING
)

if exist "apps\studio-web" (
    echo apps/studio-web: EXISTS
) else (
    echo apps/studio-web: MISSING
)

if exist "packages\shared" (
    echo packages/shared: EXISTS
) else (
    echo packages/shared: MISSING
)
echo.

echo ========================================
pause
goto menu

:clean_modules
cls
echo ========================================
echo   Cleaning node_modules
echo ========================================
echo.
echo WARNING: This will delete all installed dependencies!
echo.
choice /M "Are you sure you want to continue"
if errorlevel 2 goto menu

echo.
echo Removing node_modules...
if exist "node_modules\" (
    rmdir /s /q node_modules
    echo OK: node_modules removed.
) else (
    echo node_modules does not exist.
)

echo.
echo You need to run "Setup Environment" again to reinstall dependencies.
pause
goto menu

:update_deps
cls
echo ========================================
echo   Updating Dependencies
echo ========================================
echo.
echo This will update all npm dependencies to their latest versions.
echo.
choice /M "Continue with update"
if errorlevel 2 goto menu

echo.
cd /d "%~dp0"
call npm update

if errorlevel 1 (
    echo.
    echo ERROR: Update failed!
) else (
    echo.
    echo ========================================
    echo   Dependencies updated!
    echo ========================================
)
pause
goto menu

:exit
cls
echo ========================================
echo   Thank you for using aiGameGongfang Studio!
echo ========================================
echo.
timeout /t 2 >nul
exit /b 0
