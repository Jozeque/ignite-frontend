@echo off
rem Demo-acquisition tracker auto-refresh. Scheduled task: StrideDemoAcqTracker (every 30 min).
rem The HTML itself reloads every 5 min, so the page in the browser is never
rem older than regeneration + 5. Delete when the campaign ends:
rem   schtasks /delete /tn StrideDemoAcqTracker /f
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo ---- %date% %time% ---- >> demo_acq_autorefresh.log
python demo_acq_tracker.py >> demo_acq_autorefresh.log 2>&1
