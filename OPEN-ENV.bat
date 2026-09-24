@echo off
setlocal
cd /d "%~dp0"
set "NUVORA_HOME=%APPDATA%\Nuvora"
set "PERSISTENT_ENV=%NUVORA_HOME%\.env"
if not exist "%NUVORA_HOME%" mkdir "%NUVORA_HOME%"
if not exist ".env" if exist "%PERSISTENT_ENV%" copy /Y "%PERSISTENT_ENV%" ".env" >nul
if not exist ".env" call START-NUVORA.bat
start notepad ".env"
endlocal
