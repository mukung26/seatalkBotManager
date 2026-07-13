with open("src/BotToolsPanel.tsx", "r") as f:
    text = f.read()

text = text.replace("""      xmlns="http:""", """      xmlns="http://www.w3.org/2000/svg\"""")

with open("src/BotToolsPanel.tsx", "w") as f:
    f.write(text)
