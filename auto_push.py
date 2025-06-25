import shutil
import subprocess
import os
from datetime import datetime

# Paths
SOURCE_FILE = r"C:\ProgramData\PlayIt Live\Travel\playout_log_rolling.json"
REPO_DIR = r"C:\Users\Administrator\Dropbox\player"
DEST_FILE = os.path.join(REPO_DIR, "playout_log_rolling.json")

def run_git_command(*args):
    result = subprocess.run(["git"] + list(args), cwd=REPO_DIR, capture_output=True, text=True)
    if result.returncode != 0 and "nothing to commit" not in result.stderr:
        print(f"[ERROR] {result.stderr.strip()}")
    return result.stdout.strip()

def auto_push():
    try:
        # ✅ Copy the updated file into the repo
        shutil.copy2(SOURCE_FILE, DEST_FILE)
        # Touch the file to refresh timestamp
        os.utime(DEST_FILE, None)

        print(f"[INFO] Copied JSON from source to repo")

        # ✅ Only commit if file changed
        status = run_git_command("status", "--porcelain")
        if "playout_log_rolling.json" not in status:
            print("[INFO] No changes detected, skipping commit.")
            return

        # ✅ Git operations
        run_git_command("add", "playout_log_rolling.json")
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        run_git_command("commit", "-m", f"Auto-update playout_log_rolling.json at {timestamp}")
        run_git_command("push", "--force")
        print(f"[SUCCESS] Pushed update at {timestamp}")

    except Exception as e:
        print(f"[FAILED] {e}")

if __name__ == "__main__":
    auto_push()
