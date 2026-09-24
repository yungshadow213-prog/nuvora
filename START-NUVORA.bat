@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Nuvora keeps your private configuration outside the project folder so
rem extracting a fresh ZIP does not make you type keys again.
set "NUVORA_HOME=%APPDATA%\Nuvora"
set "PERSISTENT_ENV=%NUVORA_HOME%\.env"

if not exist "%NUVORA_HOME%" mkdir "%NUVORA_HOME%"

rem Reuse the saved configuration when this project folder is fresh.
if not exist ".env" if exist "%PERSISTENT_ENV%" copy /Y "%PERSISTENT_ENV%" ".env" >nul

rem First run: create a safe local config. The server-only key is requested once.
if not exist ".env" (
  echo Creating Nuvora configuration...
  >".env" echo PORT=3000
  >>".env" echo SUPABASE_URL=https://ittxcfwuqbzfqkclcyla.supabase.co
  >>".env" echo SUPABASE_ANON_KEY=sb_publishable_vFqpQlQMFqhJKLmx1T_LCQ_J9lesH5z
  >>".env" echo SUPABASE_SERVICE_ROLE_KEY=
  >>".env" echo SHOPIFY_STORE_DOMAIN=
  >>".env" echo SHOPIFY_ADMIN_ACCESS_TOKEN=
  >>".env" echo SHOPIFY_STOREFRONT_ACCESS_TOKEN=
  >>".env" echo SHOPIFY_API_VERSION=2026-07
  >>".env" echo AMAZON_CLIENT_ID=
  >>".env" echo AMAZON_CLIENT_SECRET=
  >>".env" echo AMAZON_PARTNER_TAG=
  >>".env" echo AMAZON_MARKETPLACE=www.amazon.com
)

rem Save an existing private configuration for future fresh ZIP extractions.
findstr /R /B /C:"SUPABASE_SERVICE_ROLE_KEY=..*" ".env" >nul 2>nul
if not errorlevel 1 copy /Y ".env" "%PERSISTENT_ENV%" >nul

rem If the private key is still blank, ask once.
findstr /R /B /C:"SUPABASE_SERVICE_ROLE_KEY=$" ".env" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo Admin features need your Supabase service-role/secret key.
  echo Enter it once below. It will be saved only on this PC in:
  echo %PERSISTENT_ENV%
  echo.
  set /p "NUVORA_SERVICE_KEY=Supabase service-role key: "
  if defined NUVORA_SERVICE_KEY (
    powershell -NoProfile -Command "$p='.env'; $s=Get-Content $p -Raw; $s=$s -replace 'SUPABASE_SERVICE_ROLE_KEY=.*','SUPABASE_SERVICE_ROLE_KEY='+$env:NUVORA_SERVICE_KEY; Set-Content -Path $p -Value $s -NoNewline"
    copy /Y ".env" "%PERSISTENT_ENV%" >nul
  )
)

set "NUVORA_PORT=3000"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do set "NUVORA_PORT=3001"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3001 .*LISTENING"') do if "%NUVORA_PORT%"=="3001" set "NUVORA_PORT=3002"
set "PORT=%NUVORA_PORT%"

echo Starting Nuvora on port %NUVORA_PORT%...
start "Nuvora Server" cmd /k "set PORT=%NUVORA_PORT%&& npm start"
timeout /t 2 >nul
start "Nuvora" "http://127.0.0.1:%NUVORA_PORT%/"
endlocal
