@echo off
setlocal EnableExtensions

cd /d "%~dp0.."
if errorlevel 1 goto :failure

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Install Node.js and try again.
    goto :failure
)

where tar >nul 2>nul
if errorlevel 1 (
    echo [ERROR] The Windows tar tool was not found.
    goto :failure
)

echo [1/2] Validating and exporting ezHighlighter...
call npm run export
if errorlevel 1 goto :failure

for /f "usebackq delims=" %%V in (`node -p "require('./manifest.json').version"`) do set "EZ_VERSION=%%V"
if not defined EZ_VERSION (
    echo [ERROR] Could not read the plugin version from manifest.json.
    goto :failure
)

set "EZ_PLUGIN_ID=ez-highlighter"
set "EZ_ZIP_NAME=ez-highlighter-v%EZ_VERSION%.zip"

echo [2/2] Creating export\%EZ_ZIP_NAME%...
if not exist "export\%EZ_PLUGIN_ID%\main.js" (
    echo [ERROR] Exported main.js is missing.
    goto :failure
)
if not exist "export\%EZ_PLUGIN_ID%\manifest.json" (
    echo [ERROR] Exported manifest.json is missing.
    goto :failure
)
if not exist "export\%EZ_PLUGIN_ID%\styles.css" (
    echo [ERROR] Exported styles.css is missing.
    goto :failure
)

if exist "export\%EZ_ZIP_NAME%" del /f /q "export\%EZ_ZIP_NAME%"
if errorlevel 1 goto :failure

tar -a -c -f "export\%EZ_ZIP_NAME%" -C "export" "%EZ_PLUGIN_ID%"
if errorlevel 1 goto :failure

echo.
echo Release package is ready:
echo %CD%\export\%EZ_ZIP_NAME%
exit /b 0

:failure
echo.
echo Release build failed.
exit /b 1
