with open("src/BotToolsPanel.tsx", "r") as f:
    text = f.read()

text = text.replace("""            )}
              <div className="space-y-4">
              <ApiSection """, """            )}
            {activeTab === 'bot' && (
              <div className="space-y-4">
              <ApiSection """)

with open("src/BotToolsPanel.tsx", "w") as f:
    f.write(text)
