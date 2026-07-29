@echo off
setlocal
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.19.0 or newer is required to build the installer.
  exit /b 1
)
node.exe "%~dp0package-installer.cjs"
exit /b %ERRORLEVEL%
