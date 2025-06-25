@echo off
cd /d "C:\Users\Administrator\Dropbox\player"

:: Run your Python script if needed
"C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe" auto_push.py

:: Git push steps
git add index.html
git commit -m "Automated update of player index.html" 2>nul
git push origin main
