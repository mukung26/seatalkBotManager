with open("src/BotToolsPanel.tsx", "r") as f:
    text = f.read()

text = text.replace("""            )}
              <div className="space-y-4">
              />""", """            )}
            {activeTab === 'bot' && (
              <div className="space-y-4">""")

text = text.replace("""            )}
            {activeTab === 'bot' && (
              <div className="space-y-4">
              />""", """            )}
            {activeTab === 'bot' && (
              <div className="space-y-4">""")

text = text.replace("""              <div className="space-y-4">
              />""", """              <div className="space-y-4">""")


with open("src/BotToolsPanel.tsx", "w") as f:
    f.write(text)
