import re

with open('src/BotToolsPanel.tsx', 'r') as f:
    text = f.read()

text = text.replace("              />\n              />", "              />")
text = text.replace("              />\n              />", "              />")

with open('src/BotToolsPanel.tsx', 'w') as f:
    f.write(text)
