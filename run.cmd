@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missingnode
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto missingnode
for %%A in (%*) do (
  if "%%~A"=="--check" goto launch
  if "%%~A"=="--help" goto launch
  if "%%~A"=="-h" goto launch
  if "%%~A"=="--status" goto launch
)
if not exist node_modules\playwright (
  where npm >nul 2>nul
  if errorlevel 1 goto missingnpm
  echo 필요한 패키지를 설치합니다 ^(npm ci^). 인터넷 연결이 필요합니다.
  call npm ci
  if errorlevel 1 goto installfailed
)
:launch
node cli.mjs %*
set "result=%errorlevel%"
goto done
:missingnode
echo Node.js 22 이상 LTS를 https://nodejs.org/ 에서 설치한 뒤 다시 실행하세요.
set "result=1"
goto done
:missingnpm
echo npm이 없습니다. https://nodejs.org/ 에서 Node.js LTS를 npm과 함께 다시 설치하세요.
set "result=1"
goto done
:installfailed
echo 설치 실패: 인터넷 연결과 폴더 쓰기 권한을 확인하고 다시 실행하세요. npm ci로 다시 시도할 수 있습니다.
set "result=1"
:done
if not "%~1"=="" exit /b %result%
rem Pause only on a console with no arguments; redirected/scripted input must not hang.
powershell -NoProfile -NonInteractive -Command "if ([Console]::IsInputRedirected) { exit 1 }" >nul 2>nul
if not errorlevel 1 pause
exit /b %result%
