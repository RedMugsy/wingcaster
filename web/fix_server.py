import re

with open('backend/src/server.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the OTP section end and the PROPERTIES section start
# We want to keep:
#   res.json({ success: true, verified: true, contact: cleaned }))
# })
#
# // ==================== PROPERTIES ====================
# app.get('/api/properties', ...)

output = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Look for the pattern where we have the OTP verify endpoint's closing
    # followed by garbage duplicate blocks
    if 'res.json({ success: true, verified: true, contact: cleaned })' in line and i + 1 < len(lines) and '})' in lines[i + 1]:
        output.append(line)
        output.append(lines[i + 1])  # the })
        i += 2
        # Skip empty lines
        while i < len(lines) and lines[i].strip() == '':
            output.append(lines[i])
            i += 1
        # Now skip all garbage until we find the real PROPERTIES section with app.get
        while i < len(lines):
            if "// ==================== PROPERTIES ====================" in lines[i] and i + 1 < len(lines) and "app.get('/api/properties'" in lines[i + 1]:
                output.append(lines[i])
                i += 1
                break
            i += 1
        continue
    
    output.append(line)
    i += 1

with open('backend/src/server.js', 'w', encoding='utf-8') as f:
    f.writelines(output)

print("Fixed server.js")
