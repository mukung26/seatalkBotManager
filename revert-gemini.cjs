const fs = require('fs');
let code = fs.readFileSync('cloudflare-worker.js', 'utf8');

const newFunc = `async function callCloudflareAI(env, messageText) {
  const aiBinding = env.AI || env.ai || env.WorkersAI || env.workers_ai;
  if (!aiBinding) {
    const keys = Object.keys(env || {});
    await logEvent(env, "error", "Cloudflare AI Binding is missing or not configured correctly", {
      available_env_keys: keys,
    });
    return "⚠️ AI Assistant error: The Workers AI binding is missing in your Cloudflare Worker settings. Please add the 'Workers AI' binding in your Cloudflare Worker Settings > Variables > Service Bindings / AI Bindings and name the variable 'AI'.";
  }
  
  // Try running models, with fallbacks to the smallest models available
  const models = [
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/meta/llama-3-8b-instruct',
    '@cf/meta/llama-2-7b-chat-int8',
    '@cf/meta/llama-2-7b-chat-fp16'
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
  return \`⚠️ AI Assistant error: Failed to generate response (\${lastError ? lastError.message : "Unknown error"}). Please ensure your Workers AI limits/subscription are active.\`;
}`;

const startMarker = 'async function callCloudflareAI(env, messageText) {';
const endMarker = '  return `⚠️ AI Assistant error: Failed to generate response (${lastError ? lastError.message : "Unknown error"}). Please ensure your Workers AI limits/subscription are active, or add GEMINI_API_KEY to variables.`;\n}';

const startIndex = code.indexOf(startMarker);
const endIndex = code.indexOf(endMarker, startIndex) + endMarker.length;

if (startIndex !== -1 && code.indexOf(endMarker, startIndex) !== -1) {
  code = code.substring(0, startIndex) + newFunc + code.substring(endIndex);
  console.log("Replaced function");
} else {
  console.log("Failed to replace function");
}

// Revert UI changes
const oldAiStatus = `<!-- Gemini AI API Key -->
                    <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-900 flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium text-slate-200 font-mono">GEMINI_API_KEY</p>
                            <p class="text-xs text-slate-500">Gemini 2.5 Flash API Key (SOP Chatbot)</p>
                        </div>
                        <div>
                            \${hasGemini 
                                ? \`<span class="inline-flex items-center gap-x-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">✅ Configured</span>\`
                                : \`<span class="inline-flex items-center gap-x-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">⚠️ Missing</span>\`
                            }
                        </div>
                    </div>

                    <!-- Cloudflare AI Binding -->
                    <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-900 flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium text-slate-200 font-mono">Workers AI (AI)</p>
                            <p class="text-xs text-slate-500">Cloudflare Edge AI Fallback</p>
                        </div>
                        <div>
                            \${hasAi 
                                ? \`<span class="inline-flex items-center gap-x-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">✅ Active Binding</span>\`
                                : \`<span class="inline-flex items-center gap-x-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">⚠️ Bind AI</span>\`
                            }
                        </div>
                    </div>`;

const newAiStatus = `<!-- Cloudflare AI Binding -->
                    <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-900 flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium text-slate-200 font-mono">Workers AI (AI)</p>
                            <p class="text-xs text-slate-500">Cloudflare Edge AI Binding</p>
                        </div>
                        <div>
                            \${hasAi 
                                ? \`<span class="inline-flex items-center gap-x-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">✅ Active Binding</span>\`
                                : \`<span class="inline-flex items-center gap-x-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">⚠️ Bind AI</span>\`
                            }
                        </div>
                    </div>`;

code = code.replace(oldAiStatus, newAiStatus);
code = code.replace(`const hasAi = !!(env.AI || env.ai || env.WorkersAI || env.workers_ai);\n      const hasGemini = !!env.GEMINI_API_KEY;`, `const hasAi = !!(env.AI || env.ai || env.WorkersAI || env.workers_ai);`);

fs.writeFileSync('cloudflare-worker.js', code);
console.log("Reverted Gemini changes");
