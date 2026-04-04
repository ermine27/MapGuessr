@echo off
setlocal EnableExtensions

REM Use UTF-8 so names like Åland are handled correctly.
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"

REM Get workspace root (two levels up from recipe directory)
pushd "%SCRIPT_DIR%..\.."
set "PROJECT_ROOT=%CD%"
popd

set "CSV_PATH=%SCRIPT_DIR%config\countries-list-coverage.csv"
set "OUTPUT_DIR=%PROJECT_ROOT%\tools\output\areas\countries"
set "EXTRACT_SCRIPT=%PROJECT_ROOT%\tools\extract-area.js"

if not exist "%CSV_PATH%" (
    echo [ERROR] CSV not found: "%CSV_PATH%"
    exit /b 1
)

if not exist "%EXTRACT_SCRIPT%" (
    echo [ERROR] Script not found: "%EXTRACT_SCRIPT%"
    exit /b 1
)

if not exist "%OUTPUT_DIR%" (
    mkdir "%OUTPUT_DIR%"
)

set /a TOTAL=0
set /a SUCCESS=0
set /a FAILED=0

echo ==========================================
echo Country area generation (Europa)
echo CSV    : %CSV_PATH%
echo Output : %OUTPUT_DIR%
echo ==========================================
echo.

for /f "usebackq tokens=1,2 delims=," %%A in ("%CSV_PATH%") do (
    if not "%%~A"=="" call :PROCESS_ONE "%%~A" "%%~B"
)

echo ==========================================
echo Completed
echo   Total   : %TOTAL%
echo   Success : %SUCCESS%
echo   Failed  : %FAILED%
echo ==========================================

if not "%FAILED%"=="0" exit /b 1
exit /b 0

:PROCESS_ONE
set /a TOTAL+=1
set "ISO=%~1"
set "NAME=%~2"
set "OUT_PATH=%OUTPUT_DIR%\%NAME%.geojson"

if exist "%OUT_PATH%" (
    echo [%TOTAL%] SKIP (already exists): %NAME%
    set /a SUCCESS+=1
    goto :eof
)

echo [%TOTAL%] %ISO% ^> %OUT_PATH%
node "%EXTRACT_SCRIPT%" country "%ISO%" --output "%OUT_PATH%"

if errorlevel 1 (
    set /a FAILED+=1
    echo   [NG] %ISO% failed
) else (
    set /a SUCCESS+=1
    echo   [OK] %ISO% done
)
echo.
goto :eof
