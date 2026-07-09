@echo off
title Stride - Port 9100 Repair
echo ===============================================
echo    STRIDE  -  PORT 9100 REPAIR
echo ===============================================
echo.
echo This clears leaked Max / Node-for-Max processes
echo that jam Stride's bridge on port 9100 (the known
echo node-leak bug). Your saved Live set is untouched.
echo.
echo   1) Make sure Ableton is FULLY CLOSED.
echo   2) Press any key to clean up.
echo.
pause
echo.
echo Cleaning up leftover processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $m=@(Get-Process | Where-Object { $_.Name -eq 'Max' -and $_.Path -like '*Live*Suite*' }); $m | Stop-Process -Force; $n=@(Get-Process node | Where-Object { $_.Path -like '*Node for Max*' }); $n | Stop-Process -Force; Start-Sleep -Milliseconds 900; Write-Host ('  Killed Max.exe: ' + $m.Count + '   Killed Node bridges: ' + $n.Count); $c = Get-NetTCPConnection -LocalPort 9100; if ($c) { Write-Host '  RESULT: port 9100 is STILL HELD. Is Ableton really fully closed? Close it and run this again.' -ForegroundColor Red } else { Write-Host '  RESULT: CLEAN. Port 9100 is free. You can reopen Ableton now.' -ForegroundColor Green }"
echo.
echo Done. You can close this window and reopen Ableton.
echo.
pause
