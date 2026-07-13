with open("src/BotToolsPanel.tsx", "r") as f:
    text = f.read()

text = text.replace("""                action={() => simulateApiCall("Get Joined Group Chat List", {
                  groups: [
                    { group_id: "GRP_alpha", name: "Alpha Team" },
                    { group_id: "GRP_devs", name: "Engineering" }
                  ]
                buttonLabel="List Groups\"""", """                action={() => simulateApiCall("Get Joined Group Chat List", {
                  groups: [
                    { group_id: "GRP_alpha", name: "Alpha Team" },
                    { group_id: "GRP_devs", name: "Engineering" }
                  ]
                })}
                buttonLabel="List Groups\"""")

with open("src/BotToolsPanel.tsx", "w") as f:
    f.write(text)
