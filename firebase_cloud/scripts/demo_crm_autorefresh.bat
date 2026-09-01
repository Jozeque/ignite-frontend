@echo off
rem Stride demo CRM regeneration. Scheduled task: StrideDemoCRM (every 30 min).
rem The page does NOT reload itself, on purpose: it is worked in rather than watched,
rem and a reload would close whatever record was open. It shows its own age instead
rem and offers a reload link once it passes 40 minutes.
rem Remove with:  schtasks /delete /tn StrideDemoCRM /f
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
echo ---- %date% %time% ---- >> demo_crm_autorefresh.log
python demo_crm.py >> demo_crm_autorefresh.log 2>&1
