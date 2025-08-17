@echo off
cd /d "C:\Users\Administrator\Dropbox\player"

    git add news_bulletin.txt
    git commit -m "Update Local News"
    git push origin main
    exit /b
)
