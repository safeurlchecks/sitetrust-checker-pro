@echo off
cd /d "%~dp0"
echo ==========================================
echo SiteTrust Checker Pro - Cloudflare Deploy
echo ==========================================
echo.
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js is not installed.
  echo Install Node.js LTS first from https://nodejs.org/
  pause
  exit /b 1
)
echo Node.js found.
echo.
echo Installing deployment tool if needed...
call npm install
if %errorlevel% neq 0 (
  echo npm install failed.
  pause
  exit /b 1
)
echo.
echo Login to Cloudflare. A browser window may open.
call npx wrangler login
echo.
echo Deploying to Cloudflare Workers with static assets...
call npx wrangler deploy
if %errorlevel% neq 0 (
  echo Deploy failed. Check the error above.
  pause
  exit /b 1
)
echo.
echo Deploy complete.
echo Open the workers.dev URL shown above.
echo Test: /api/health should show ok true.
pause
