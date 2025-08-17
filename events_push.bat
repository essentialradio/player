@echo off
cd /d "C:\Users\Administrator\Dropbox\player"

    git add events-ayrshire.json
    git commit -m "Update Events"
    git push origin main
    exit /b
)
