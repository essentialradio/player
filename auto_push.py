import shutil
import subprocess
import os
import time
from datetime import datetime

# Paths
SOURCE_DIR = r"C:\ProgramData\PlayIt Live\Travel"
REPO_DIR = r"C:\Users\Administrator\Dropbox\player"
FILES_TO_COPY = ["playout_log_rolling.json", "latestTrack.json"]

def run_git_command(*args):
    result = subprocess.run(["git"] + list(args), cwd=REPO_DIR, capture_output=True, text=True)
    if result.returncode != 0 and "nothing to commit" not in result.stderr:
        print(f"[ERROR] {result.stderr.strip()}")
    return result.stdout.strip()

def auto_push():
    try:
        changes_detected = False

        # ✅ Copy each file and check for changes
        for filename in FILES_TO_COPY:
            src = os.path.join(SOURCE_DIR, filename)
            dest = os.path.join(REPO_DIR, filename)

            shutil.copy2(src, dest)
            os.utime(dest, None)  # Update timestamp

            print(f"[INFO] Copied {filename} to repo")

        # Check git status
        status = run_git_command("status", "--porcelain")
        if not any(f in status for f in FILES_TO_COPY):
            print("[INFO] No changes detected in tracked files, skipping commit.")
            return

        # Git operations
        for filename in FILES_TO_COPY:
            run_git_command("add", filename)
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        run_git_command("commit", "-m", f"Auto-update files at {timestamp}")
        run_git_command("push", "--force")
        print(f"[SUCCESS] Pushed update at {timestamp}")

    except Exception as e:
        print(f"[FAILED] {e}")

if __name__ == "__main__":
    while True:
        auto_push()
        time.sleep(15)
