@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules\playwright (
  call npm ci
  if errorlevel 1 exit /b 1
)
node cli.mjs %*
exit /b %errorlevel%
