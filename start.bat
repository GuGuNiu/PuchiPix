@echo off
setlocal EnableExtensions

set "FRONTEND_DIR=%~dp0frontend"
set "BACKEND_DIR=%~dp0backend"
set "DATA_DIR=%~dp0data"
set "BACKEND_PORT=10541"
set "FRONTEND_PORT=10540"

where go >nul 2>&1
if errorlevel 1 goto :missing_go

where pnpm >nul 2>&1
if errorlevel 1 goto :missing_pnpm

if not exist "%FRONTEND_DIR%\package.json" goto :missing_frontend
if not exist "%BACKEND_DIR%\go.mod" goto :missing_backend
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%" goto :missing_data

set "SERVER_PORT=%BACKEND_PORT%"
set "DB_PATH=%DATA_DIR%\puchipix.db"
set "GO_ENV=development"
set "PORT=%FRONTEND_PORT%"
set "GO_BACKEND_PORT=%BACKEND_PORT%"

call :is_backend_ready
if not errorlevel 1 goto :backend_running
call :is_port_listening %BACKEND_PORT%
if not errorlevel 1 goto :backend_port_in_use
start "PuchiPix Backend" /D "%BACKEND_DIR%" cmd /k "go run -buildvcs=false ./cmd/server"
set "BACKEND_STATUS=started"
goto :backend_started

:backend_running
set "BACKEND_STATUS=already running"
goto :backend_started

:backend_started
call :is_port_listening %FRONTEND_PORT%
if not errorlevel 1 goto :frontend_running
if exist "%FRONTEND_DIR%\node_modules\.bin\vite.cmd" goto :start_frontend
start "PuchiPix Frontend" /D "%FRONTEND_DIR%" cmd /k "pnpm install --frozen-lockfile && pnpm dev"
set "FRONTEND_STATUS=starting; dependencies will be installed"
goto :started

:start_frontend
start "PuchiPix Frontend" /D "%FRONTEND_DIR%" cmd /k "pnpm dev"
set "FRONTEND_STATUS=started"
goto :started

:frontend_running
set "FRONTEND_STATUS=already running"

:started
echo.
echo PuchiPix is starting.
echo Backend:  %BACKEND_STATUS%
echo Frontend: %FRONTEND_STATUS%
echo URL:      http://localhost:%FRONTEND_PORT%
endlocal
exit /b 0

:is_backend_ready
powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%BACKEND_PORT%/api/health' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch { exit 1 }; exit 1" >nul 2>&1
exit /b %errorlevel%

:is_port_listening
powershell.exe -NoProfile -Command "$connection = Get-NetTCPConnection -LocalPort %1 -State Listen -ErrorAction SilentlyContinue; if ($null -ne $connection) { exit 0 }; exit 1" >nul 2>&1
exit /b %errorlevel%

:backend_port_in_use
echo [ERROR] Backend port %BACKEND_PORT% is occupied, but the PuchiPix health check failed.
echo Close the process using this port and try again.
pause
exit /b 1

:missing_go
echo [ERROR] Go was not found in PATH.
pause
exit /b 1

:missing_pnpm
echo [ERROR] pnpm was not found in PATH.
pause
exit /b 1

:missing_frontend
echo [ERROR] Frontend directory is missing: "%FRONTEND_DIR%"
pause
exit /b 1

:missing_backend
echo [ERROR] Backend directory is missing: "%BACKEND_DIR%"
pause
exit /b 1

:missing_data
echo [ERROR] Failed to create data directory: "%DATA_DIR%"
pause
exit /b 1
