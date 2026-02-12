import os
import subprocess
import sys
import time

import json

def get_status_file():
    return os.path.join(os.path.dirname(__file__), 'update_status.json')

def write_status(progress, current_script, status="running"):
    try:
        data = {
            "progress": progress,
            "current_script": current_script,
            "status": status,
            "timestamp": time.time()
        }
        with open(get_status_file(), 'w') as f:
            json.dump(data, f)
    except Exception as e:
        print(f"Failed to write status: {e}")

def run_script(script_name, progress):
    print(f"\n{'='*50}")
    print(f"Starting {script_name}...")
    print(f"{'='*50}")
    start_time = time.time()
    
    try:
        # Use Popen to capture output in real-time
        process = subprocess.Popen(
            [sys.executable, "-u", script_name],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        last_log = ""
        # Read output line by line
        for line in process.stdout:
            line = line.strip()
            if line:
                print(line)
                last_log = line
                # Update status with the log line
                # We limit the length of the log message for the UI
                display_msg = line[:100] + "..." if len(line) > 100 else line
                write_status(progress, f"{script_name}: {display_msg}", "running")
                
        process.wait()
        
        if process.returncode == 0:
            duration = time.time() - start_time
            print(f"\n[SUCCESS] {script_name} finished in {duration:.2f} seconds.")
            return True
        else:
            print(f"\n[ERROR] {script_name} failed with exit code {process.returncode}.")
            # If failed, return the last log as error part
            return False
            
    except Exception as e:
        print(f"\n[ERROR] An unexpected error occurred while running {script_name}: {e}")
        return False

def main():
    scripts = [
        "league_scraper.py",
        "ranking_scraper.py",
        "club_scraper.py",
        "archive_scraper.py",
        "archive_tables_scraper.py"
    ]
    
    overall_start = time.time()
    success_count = 0
    total_scripts = len(scripts)
    
    print("Starting Global Data Update...")
    write_status(0, "Starting...", "running")
    
    for i, script in enumerate(scripts):
        # Calculate progress: based on how many scripts we are about to run
        progress = int((i / total_scripts) * 100)
        write_status(progress, f"Starting {script}...", "running")
        
        if run_script(script, progress):
            success_count += 1
        else:
            print(f"\n[WARNING] Stopping update sequence due to failure in {script}.")
            write_status(progress, script, "error")
            break
            
    total_duration = time.time() - overall_start
    print(f"\n{'='*50}")
    
    if success_count == len(scripts):
        print(f"UPDATE COMPLETE: All {len(scripts)} scripts ran successfully.")
        write_status(100, "Fertig!", "complete")
    else:
        print(f"UPDATE INCOMPLETE: Only {success_count}/{len(scripts)} scripts ran successfully.")
        # Status file already set to error or partial
        
    print(f"Total time: {total_duration:.2f} seconds")
    print(f"{'='*50}")

if __name__ == "__main__":
    main()
