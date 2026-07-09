@echo off
REM Windows Task Scheduler entry point for the daily Stride campaign.
REM Runs the bash runner via git-bash and appends output to campaign.log.
"C:\Program Files\Git\bin\bash.exe" -lc "cd /c/Users/Yossi/Desktop/Desktop_MIDI_APP/firebase_cloud/scripts && ./run_campaign.sh >> campaign.log 2>&1"
