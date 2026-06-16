@echo off
setlocal
REM ReelCrop one-click launcher - double-click THIS instead of record.py
REM Run from this folder so record.py finds its config/scripts
cd /d "%~dp0"
REM Make ffmpeg (installed via winget) findable for the render step
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
py record.py
echo.
echo ---- ReelCrop finished. Press any key to close this window. ----
pause >nul
