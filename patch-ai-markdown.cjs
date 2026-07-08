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


// 3. Update sendGroupMessage to use markdown (keeping sendPrivateMessage as plain text since single chat doesn't support markdown)
const sendGroupTarget = 'const messageData = messageObj ? JSON.parse(JSON.stringify(messageObj)) : { tag: "text", text: { content: text } };';
const sendGroupReplacement = 'const messageData = messageObj ? JSON.parse(JSON.stringify(messageObj)) : { tag: "markdown", markdown: { content: text } };';
// Since both sendPrivateMessage and sendGroupMessage have this exact line, we do code.replace on the second occurrence.
// Or we can replace in sendGroupMessage function body specifically.
const sendGroupFunctionTarget = 'async function sendGroupMessage(env, groupId, text, threadId, messageObj) {\n  const token = await getAccessToken(env);\n  const messageData = messageObj ? JSON.parse(JSON.stringify(messageObj)) : { tag: "text", text: { content: text } };';
const sendGroupFunctionReplacement = 'async function sendGroupMessage(env, groupId, text, threadId, messageObj) {\n  const token = await getAccessToken(env);\n  const messageData = messageObj ? JSON.parse(JSON.stringify(messageObj)) : { tag: "markdown", markdown: { content: text } };';
code = code.replace(sendGroupFunctionTarget, sendGroupFunctionReplacement);

fs.writeFileSync('cloudflare-worker.js', code);
