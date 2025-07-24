@echo off
cd /d "C:\Users\Administrator\Dropbox\player"

REM Remove the folder locally
rmdir /s /q public\travel

REM Stage the deletion
git add -A

REM Commit the deletion
git commit -m "Delete public/travel folder from repo"

REM Push the commit to the remote server
git push

exit /b
