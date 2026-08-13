with open('backend/src/server.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find and fix the duplicate app.post('/api/agencies' pattern
output = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Look for the pattern: app.post('/api/agencies', authMiddleware, (req, res) => {
    # followed by const { name... 
    # followed by ANOTHER app.post('/api/agencies'... 
    if "app.post('/api/agencies', authMiddleware, (req, res) => {" in line and i + 2 < len(lines):
        # Check if the next few lines contain a duplicate
        next_lines = ''.join(lines[i+1:i+4])
        if "app.post('/api/agencies'" in next_lines:
            # This is the bad block - keep the first app.post and const line,
            # skip the duplicate app.post and duplicate const line
            output.append(line)  # app.post('/api/agencies'...
            output.append(lines[i+1])  # const { name...
            # Skip lines until we find the real continuation (const existingAff...)
            j = i + 2
            while j < len(lines) and 'const existingAff' not in lines[j]:
                j += 1
            i = j
            continue
    
    output.append(line)
    i += 1

with open('backend/src/server.js', 'w', encoding='utf-8') as f:
    f.writelines(output)

print("Fixed duplicate agencies endpoint")
