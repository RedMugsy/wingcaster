import subprocess
import os
import sys

os.chdir(r'C:/Users/AliAchkar/Documents/kimi/workspace/souq-ajjar-realestate')

# Start backend
with open('backend.log', 'w') as f:
    backend = subprocess.Popen(
        ['node', 'backend/src/server.js'],
        stdout=f, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
    )

# Start Python preview server  
with open('preview.log', 'w') as f:
    preview = subprocess.Popen(
        ['python', 'preview.py'],
        stdout=f, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
    )

with open('servers.pid', 'w') as f:
    f.write(f'backend={backend.pid}\npreview={preview.pid}\n')

print('OK')
