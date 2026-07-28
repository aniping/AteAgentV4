@echo off
setlocal
set "PATH=%~dp0runtime;%PATH%"
"%~dp0runtime\node.exe" "%~dp0launcher.cjs" %*
set "PI_WEB_EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %PI_WEB_EXIT_CODE%
