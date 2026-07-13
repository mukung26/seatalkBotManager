with open("src/BotToolsPanel.tsx", "r") as f:
    lines = f.readlines()

new_lines = []
in_api = False
for line in lines:
    if "<ApiSection" in line:
        if in_api:
            new_lines.append("              />\n")
        in_api = True
    elif "</div>" in line and in_api:
        new_lines.append("              />\n")
        in_api = False
    new_lines.append(line)

with open("src/BotToolsPanel.tsx", "w") as f:
    f.writelines(new_lines)
