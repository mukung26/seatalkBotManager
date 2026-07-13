with open("src/BotToolsPanel.tsx", "r") as f:
    text = f.read()

text = text.replace('                buttonLabel="Get Code"', '                action={() => simulateApiCall("Get Employee Code with Email", { employee_code: "EMP-001" })}\n                buttonLabel="Get Code"')
text = text.replace('                buttonLabel="Check Status"', '                action={() => simulateApiCall("Get Employee Status", { status: "Active", joined_at: "2024-01-01" })}\n                buttonLabel="Check Status"')
text = text.replace('                buttonLabel="Verify Existence"', '                action={() => simulateApiCall("Check Employee Existence", { exists: true, user_id: "ST_ID_1020" })}\n                buttonLabel="Verify Existence"')
text = text.replace('                buttonLabel="Get Preference"', '                action={() => simulateApiCall("Get User Language Preference", { language_code: "en-US" })}\n                buttonLabel="Get Preference"')
text = text.replace('                buttonLabel="Create Group"', '                action={() => simulateApiCall("Create Group Chat", { group_id: "GRP_789xyz123", status: "success" })}\n                buttonLabel="Create Group"')
text = text.replace('                buttonLabel="Update Members"', '                action={() => simulateApiCall("Manage Group Members", { modifiedCount: 1, status: "success" })}\n                buttonLabel="Update Members"')
text = text.replace('                buttonLabel="Fetch Info"', '                action={() => simulateApiCall("Get Group Info", { group_name: "Project Delta", member_count: 5, bot_is_admin: false })}\n                buttonLabel="Fetch Info"')

with open("src/BotToolsPanel.tsx", "w") as f:
    f.write(text)
