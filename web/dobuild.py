import subprocess
import os

os.chdir(r'C:/Users/AliAchkar/Documents/kimi/workspace/souq-ajjar-realestate')

npm = r'C:/Users/AliAchkar/AppData/Local/Programs/kimi-desktop/resources/resources/runtime/npm.cmd'

r = subprocess.run([npm, 'run', 'build'], capture_output=True, text=True)
print('=== STDOUT ===')
print(r.stdout[-3000:] if len(r.stdout) > 3000 else r.stdout)
print('=== STDERR ===')
print(r.stderr[-1500:] if len(r.stderr) > 1500 else r.stderr)
print('=== EXIT CODE ===')
print(r.returncode)
