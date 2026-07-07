const fs = require('fs');
let code = fs.readFileSync('cloudflare-worker.js', 'utf8');

// 1. Add GEMINI to Env status
const oldEnvVars = `const hasAi = !!(env.AI || env.ai || env.WorkersAI || env.workers_ai);`;
const newEnvVars = `const hasAi = !!(env.AI || env.ai || env.WorkersAI || env.workers_ai);\n      const hasGemini = !!env.GEMINI_API_KEY;`;

code = code.replace(oldEnvVars, newEnvVars);

const oldAiStatus = `<!-- Cloudflare AI Binding -->
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

const newAiStatus = `<!-- Gemini AI API Key -->
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

code = code.replace(oldAiStatus, newAiStatus);

fs.writeFileSync('cloudflare-worker.js', code);
console.log("Patched UI");
