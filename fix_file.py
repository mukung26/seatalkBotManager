import re

with open('src/BotToolsPanel.tsx', 'r') as f:
    text = f.read()

text = text.replace("""            {activeTab === 'bot' && (
              <div className="space-y-4">
              <ApiSection 
                title="Update Message" 
                desc="Update an interactive message sent previously using its message_id."
                buttonLabel="Apply Update" 
                 inputs={[
                   { label: "Message ID", placeholder: "msg_..." },
            {activeTab === 'bot' && (
              <div className="space-y-4">
              />""", """            {activeTab === 'bot' && (
              <div className="space-y-4">""")

text = text.replace("              />\n              />", "              />")

with open('src/BotToolsPanel.tsx', 'w') as f:
    f.write(text)
