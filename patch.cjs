const fs = require('fs');
let code = fs.readFileSync('cloudflare-worker.js', 'utf8');

// 1. Add GEMINI_API_KEY to comments
code = code.replace('* - FIREBASE_API_KEY', '* - FIREBASE_API_KEY\n * - GEMINI_API_KEY');

// 2. Replace callCloudflareAI logic
const oldFuncStart = 'async function callCloudflareAI(env, messageText) {';
const newFunc = `async function callCloudflareAI(env, messageText) {
  // Try Gemini AI first if the key is provided
  if (env.GEMINI_API_KEY) {
    try {
      await logEvent(env, "info", "Attempting Gemini AI inference", { messageText });
      const url = \`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\${env.GEMINI_API_KEY}\`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{
              text: \`You are a friendly, professional Customer Service Assistant for Shopee Choice. Provide short, concise, and helpful answers. Do not use markdown formatting that isn't compatible with standard chat apps.\\n\\nHere is the full standard operating procedure (SOP) you should follow to answer questions:\\n\\n\${SOP_TEXT}\`
            }]
          },
          contents: [{ role: "user", parts: [{ text: messageText }] }]
        })
      });
      
      const data = await response.json();
      if (data.candidates && data.candidates.length > 0) {
        return data.candidates[0].content.parts[0].text;
      }
      throw new Error("Invalid response from Gemini: " + JSON.stringify(data));
    } catch (err) {
      await logEvent(env, "warning", "Gemini AI failed, falling back to Cloudflare AI", { error: err.toString() });
    }
  }

  const aiBinding = env.AI || env.ai || env.WorkersAI || env.workers_ai;
  if (!aiBinding) {
    const keys = Object.keys(env || {});
    await logEvent(env, "error", "Cloudflare AI Binding is missing or not configured correctly", {
      available_env_keys: keys,
    });
    return "⚠️ AI Assistant error: The Workers AI binding is missing in your Cloudflare Worker settings. Please add the 'Workers AI' binding or 'GEMINI_API_KEY' in your Cloudflare Worker Settings > Variables.";
  }
  
  // Try running models, with fallbacks
  const models = [
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/meta/llama-3-8b-instruct',
    '@cf/meta/llama-2-7b-chat-int8'
  ];

  let lastError = null;
  for (const model of models) {
    try {
      await logEvent(env, "info", \`Attempting Cloudflare AI inference\`, { model, messageText });
      
      // We truncate SOP for Cloudflare to avoid massive context limit errors
      const truncatedSop = SOP_TEXT.substring(0, 4000); 

      const aiResponse = await aiBinding.run(model, {
        messages: [
          { 
            role: "system", 
            content: \`You are a friendly, professional Customer Service Assistant for Shopee Choice. Provide short, concise, and helpful answers. Do not use markdown formatting that isn't compatible with standard chat apps.\\n\\nHere is a partial standard operating procedure (SOP) you should follow to answer questions:\\n\\n\${truncatedSop}\`
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
  return \`⚠️ AI Assistant error: Failed to generate response (\${lastError ? lastError.message : "Unknown error"}). Please ensure your Workers AI limits/subscription are active, or add GEMINI_API_KEY to variables.\`;
}`;

const oldFuncEnd = '  return `⚠️ AI Assistant error: Failed to generate response (${lastError ? lastError.message : "Unknown error"}). Please ensure your Workers AI limits/subscription are active.`;\n}';

const startIndex = code.indexOf(oldFuncStart);
const endIndex = code.indexOf(oldFuncEnd, startIndex) + oldFuncEnd.length;

if (startIndex === -1 || code.indexOf(oldFuncEnd, startIndex) === -1) {
  console.error("Could not find function to replace.");
  process.exit(1);
}

const newCode = code.substring(0, startIndex) + newFunc + code.substring(endIndex);
fs.writeFileSync('cloudflare-worker.js', newCode);
console.log("Patched successfully");
