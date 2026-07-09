@echo off
rem Launch the 9:16 story overlay using the Electron already installed in stride-vst\app.
setlocal
set "HERE=%~dp0"
set "ELECTRON=%HERE%..\..\stride-vst\app\node_modules\electron\dist\electron.exe"

if exist "%ELECTRON%" (
  start "" "%ELECTRON%" "%HERE%."
) else (
  echo Repo Electron not found, falling back to npx electron...
  npx electron "%HERE%."
)
endlocal
