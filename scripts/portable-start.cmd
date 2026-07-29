@echo off
setlocal
title ATE Agent Server
set "PATH=%~dp0runtime\node;%PATH%"
"%~dp0ATE-Agent.exe" %*
set "PI_WEB_EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %PI_WEB_EXIT_CODE%
