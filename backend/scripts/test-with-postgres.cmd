@echo off
setlocal
set "BACKEND_DIR=%~dp0.."
set "COMPOSE_FILE=%BACKEND_DIR%\docker-compose.test.yml"

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker not detected. Set TEST_DATABASE_URL and run npm run test:pg instead.
  exit /b 1
)

docker compose -f "%COMPOSE_FILE%" up -d --wait
if errorlevel 1 exit /b %errorlevel%

set "TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/wingcaster_test"
pushd "%BACKEND_DIR%"
call npm test
set "TEST_EXIT=%errorlevel%"
popd

if not "%KEEP_POSTGRES%"=="1" docker compose -f "%COMPOSE_FILE%" down --volumes --remove-orphans
exit /b %TEST_EXIT%
