with open("src/BotToolsPanel.tsx", "r") as f:
    lines = f.readlines()

new_lines = []
skip = False
for i, line in enumerate(lines):
    if "            {activeTab === 'bot' && (" in line and "              <ApiSection " in lines[i+2] and '                title="Update Message"' in lines[i+3] and '                buttonLabel="Apply Update"' in lines[i+5]:
        skip = True
        continue
    
    if skip and '            {activeTab === \'bot\' && (' in line and '              <div className="space-y-4">' in lines[i+1]:
        skip = False
        continue
    
    if not skip:
        new_lines.append(line)

with open("src/BotToolsPanel.tsx", "w") as f:
    f.writelines(new_lines)
