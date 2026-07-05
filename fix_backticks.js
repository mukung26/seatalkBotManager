import fs from 'fs';

let code = fs.readFileSync('src/App.tsx', 'utf8');

// The markdown string is between line 83 and 133 roughly. Let's just escape all backticks in that block.
const startIndex = code.indexOf('const markdownStructure = `# SeaTalk Bot Dashboard');
if (startIndex !== -1) {
  const startTick = code.indexOf('`', startIndex);
  const importIndex = code.indexOf('import {', startTick); // Wait, there's `import { collection` later on.
  
  // Actually, we can just replace all ``` with \`\`\` everywhere in the file? No, that would break things.
}

code = code.replace(/```text/g, '\\`\\`\\`text');
code = code.replace(/```\n/g, '\\`\\`\\`\n');
code = code.replace(/`src\/App\.tsx`/g, '\\`src/App.tsx\\`');
code = code.replace(/`cloudflare-worker\.js`/g, '\\`cloudflare-worker.js\\`');
code = code.replace(/`server\.ts`/g, '\\`server.ts\\`');
code = code.replace(/`interactive_message_click`/g, '\\`interactive_message_click\\`');
code = code.replace(/`bot_added_to_group_chat`/g, '\\`bot_added_to_group_chat\\`');
code = code.replace(/`message_from_bot_subscriber`/g, '\\`message_from_bot_subscriber\\`');
code = code.replace(/`sendPrivateMessage`/g, '\\`sendPrivateMessage\\`');
code = code.replace(/`sendGroupMessage`/g, '\\`sendGroupMessage\\`');
code = code.replace(/`quoted_message_id`/g, '\\`quoted_message_id\\`');
code = code.replace(/`SeaTalk -> Webhook Listener \(cloudflare-worker\.js\) -> Firestore Data -> Bot Replies`/g, '\\`SeaTalk -> Webhook Listener (cloudflare-worker.js) -> Firestore Data -> Bot Replies\\`');
code = code.replace(/`React Frontend -> \/api\/dashboard\/\* -> Cloudflare Worker \/ Firestore -> Returns data stream to Admin UI`/g, '\\`React Frontend -> /api/dashboard/* -> Cloudflare Worker / Firestore -> Returns data stream to Admin UI\\`');
code = code.replace(/`SeaTalk -> Webhook \(bot\) -> Logic Evaluation -> Appends to Google Sheet -> Bot gives feedback response.`/g, '\\`SeaTalk -> Webhook (bot) -> Logic Evaluation -> Appends to Google Sheet -> Bot gives feedback response.\\`');

fs.writeFileSync('src/App.tsx', code);
console.log('Fixed backticks.');
