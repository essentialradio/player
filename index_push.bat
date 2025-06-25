@echo off
cd /d "C:\Users\Administrator\Dropbox\player"

:: Check if index.html has actually changed
for /f "tokens=*" %%i in ('git status --porcelain index.html') do (
    echo Committing updated index.html...
    git add index.html
    git commit -m "Update index.html"
    git push origin main
    start https://essentialradio.github.io/player/
    exit /b
)

echo No changes to index.html. Exiting.
