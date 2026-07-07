const fs = require('fs');
let code = fs.readFileSync('cloudflare-worker.js', 'utf8');

// 1. Change AI prompt to allow Markdown
code = code.replace(
  'Do not use markdown formatting that isn\\'t compatible with standard chat apps.',
  'You can use markdown formatting.'
);

// 2. Add logging for AI Response
const targetAiLog = 'const aiResponseText = await callCloudflareAI(env, content);\\n                if (aiResponseText) {';
const replacementAiLog = 'const aiResponseText = await callCloudflareAI(env, content);\\n                await logEvent(env, "info", "AI Response Generated", { aiResponseText });\\n                if (aiResponseText) {';
code = code.replace('const aiResponseText = await callCloudflareAI(env, content);\n                if (aiResponseText) {', 'const aiResponseText = await callCloudflareAI(env, content);\n                await logEvent(env, "info", "AI Response Generated", { aiResponseText });\n                if (aiResponseText) {');

code = code.replace('const aiResponseText = await callCloudflareAI(env, content);\n                if (aiResponseText) {', 'const aiResponseText = await callCloudflareAI(env, content);\n                await logEvent(env, "info", "AI Response Generated", { aiResponseText });\n                if (aiResponseText) {');


// 3. Update sendPrivateMessage to use markdown
const sendPrivateTarget = 'const messageData = messageObj ? messageObj : { tag: "text", text: { format: 1, content: text } };';
const sendPrivateReplacement = 'const messageData = messageObj ? messageObj : { tag: "markdown", markdown: { content: text } };';
code = code.replace(sendPrivateTarget, sendPrivateReplacement);
code = code.replace(sendPrivateTarget, sendPrivateReplacement); // Do it twice because it's also in sendGroupMessage

fs.writeFileSync('cloudflare-worker.js', code);
