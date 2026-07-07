const fs = require('fs');
let code = fs.readFileSync('cloudflare-worker.js', 'utf8');

// Remove SOP_TEXT
const sopStart = 'const SOP_TEXT = `';
const startIndex = code.indexOf(sopStart);
if (startIndex !== -1) {
  // Find the end of SOP_TEXT which is right before `async function callCloudflareAI`
  const funcStart = 'async function callCloudflareAI(env, messageText) {';
  const nextFuncIndex = code.indexOf(funcStart, startIndex);
  if (nextFuncIndex !== -1) {
    code = code.substring(0, startIndex) + code.substring(nextFuncIndex);
    console.log("Removed SOP_TEXT");
  }
}

// Update callCloudflareAI
const oldFuncStart = 'async function callCloudflareAI(env, messageText) {';
const newFunc = `async function callCloudflareAI(env, messageText) {
  const aiBinding = env.AI || env.ai || env.WorkersAI || env.workers_ai;
  if (!aiBinding) {
    const keys = Object.keys(env || {});
    await logEvent(env, "error", "Cloudflare AI Binding is missing or not configured correctly", {
      available_env_keys: keys,
    });
    return "⚠️ AI Assistant error: The Workers AI binding is missing in your Cloudflare Worker settings. Please add the 'Workers AI' binding in your Cloudflare Worker Settings > Variables > Service Bindings / AI Bindings and name the variable 'AI'.";
  }
  
  // Try running models, with fallbacks
  const models = [
    '@cf/meta/llama-3.2-1b-instruct',
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/meta/llama-3-8b-instruct',
    '@cf/meta/llama-2-7b-chat-int8',
    '@cf/meta/llama-2-7b-chat-fp16'
  ];

  let lastError = null;
  for (const model of models) {
    try {
      await logEvent(env, "info", \`Attempting Cloudflare AI inference\`, { model, messageText });
      
      const aiResponse = await aiBinding.run(model, {
        messages: [
          { 
            role: "system", 
            content: \`You are a friendly, helpful conversational bot. Answer any questions clearly and concisely. Do not use markdown formatting that isn't compatible with standard chat apps.\`
          },
          { 
            role: "user", 
            content: messageText 
          }
        ]
      });
      
      const responseText = aiResponse.response || (aiResponse.result && aiResponse.result.response) || aiResponse.text;
      if (responseText) {
        return responseText;
      }
    } catch (err) {
      console.error(\`AI Model \${model} Error:\`, err);
      lastError = err;
      await logEvent(env, "warning", \`AI Model \${model} failed, trying next fallback\`, {
        error: err.toString(),
        message: err.message
      });
    }
  }

  await logEvent(env, "error", "All Cloudflare AI model attempts failed", {
    error: lastError ? lastError.toString() : "Unknown error"
  });
  return \`⚠️ AI Assistant error: Failed to generate response (\${lastError ? lastError.message : "Unknown error"}). Please ensure your Workers AI limits/subscription are active.\`;
}`;

const endMarker = '  return `⚠️ AI Assistant error: Failed to generate response (${lastError ? lastError.message : "Unknown error"}). Please ensure your Workers AI limits/subscription are active.`;\n}';

const funcStartIndex = code.indexOf(oldFuncStart);
const funcEndIndex = code.indexOf(endMarker, funcStartIndex) + endMarker.length;

if (funcStartIndex !== -1 && code.indexOf(endMarker, funcStartIndex) !== -1) {
  code = code.substring(0, funcStartIndex) + newFunc + code.substring(funcEndIndex);
  console.log("Updated callCloudflareAI");
}

fs.writeFileSync('cloudflare-worker.js', code);
