
/**
 * SeaTalk Bot Webhook - Cloudflare Worker with Cloudflare D1
 * ===============================================================
 * Deploy this to your Cloudflare Worker.
 * Make sure to bind a Cloudflare D1 database named 'DB' in the Cloudflare Dashboard:
 * Under Worker Settings > D1 Database Bindings.
 * Add these environment variables in the Cloudflare Dashboard:
 * - SEATALK_APP_ID
 * - SEATALK_APP_SECRET
 * - SEATALK_EVENT_SECRET
 */

const SEATALK_API = "https://openapi.seatalk.io";

// Create tables automatically if they don't exist
async function resolveEmployeeCode(env, targetId) {
  if (!targetId.includes("@")) {
    return targetId;
  }
  const token = await getAccessToken(env);
  const res = await fetch(`${SEATALK_API}/contacts/v2/get_employee_code_with_email`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ emails: [targetId] })
  });
  if (res.ok) {
    const data = await res.json();
    if (data.code === 0 && data.employees && data.employees.length > 0) {
      // Find the first matching employee with code 0 and status 2 (in position) if possible, else just first valid one
      const emp = data.employees.find(e => e.code === 0 && e.employee_status === 2) || 
                  data.employees.find(e => e.code === 0 && e.employee_code);
      if (emp && emp.employee_code) {
        return emp.employee_code;
      }
    }
  }
  return targetId;
}

async function ensureD1Tables(db) {
  if (!db) return;
  await db.exec("CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, chat_type TEXT, employee_code TEXT, group_id TEXT, group_name TEXT, user_name TEXT, user_email TEXT, last_message TEXT, last_message_time TEXT, unread_count INTEGER DEFAULT 0, status TEXT DEFAULT 'active');");
  await db.exec("CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT, message_id TEXT, sender TEXT, sender_name TEXT, content TEXT, tag TEXT, employee_code TEXT, group_id TEXT, is_auto_reply INTEGER DEFAULT 0, sent_at TEXT, thread_id TEXT, quoted_message_id TEXT, raw_message TEXT);");
  await db.exec("CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, trigger_type TEXT, keywords TEXT, match_type TEXT, reply_message TEXT, is_active INTEGER DEFAULT 1, priority INTEGER DEFAULT 0);");
  await db.exec("CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, timestamp TEXT, level TEXT, message TEXT, details TEXT);");
  await db.exec("CREATE TABLE IF NOT EXISTS broadcasts (id TEXT PRIMARY KEY, title TEXT, content TEXT, target_type TEXT, target_value TEXT, status TEXT DEFAULT 'pending', scheduled_at TEXT, sent_at TEXT, created_at TEXT);");
  await db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);");
  await db.exec("CREATE TABLE IF NOT EXISTS message_actions (id TEXT PRIMARY KEY, message_id TEXT, employee_code TEXT, callback_value TEXT, timestamp TEXT);");
}

async function logEvent(env, level, message, details = {}) {
  try {
    console.log(`[${level}] ${message}`, details);
    if (!env.DB) return;
    await ensureD1Tables(env.DB);
    let detailsString = typeof details === 'object' ? JSON.stringify(details) : String(details);
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    await env.DB.prepare(
      "INSERT INTO logs (id, timestamp, level, message, details) VALUES (?, ?, ?, ?, ?)"
    ).bind(
      id,
      new Date().toISOString(),
      level,
      message,
      detailsString
    ).run();
  } catch (err) {
    console.error("Error in logEvent:", err);
  }
}

async function getAccessToken(env) {
  const url = `${SEATALK_API}/auth/app_access_token`;
  const body = {
    app_id: env.SEATALK_APP_ID,
    app_secret: env.SEATALK_APP_SECRET,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Failed to get access token: ${data.message}`);
  return data.app_access_token;
}

async function findMatchingRule(env, messageText, email, employeeCode, chatType) {
  try {
    if (!env.DB) return null;
    await ensureD1Tables(env.DB);
    const { results } = await env.DB.prepare(
      "SELECT * FROM rules WHERE is_active = 1 AND trigger_type = 'keyword' ORDER BY priority DESC"
    ).all();
    if (!results || results.length === 0) return null;
    
    const lowerMsg = messageText.toLowerCase();
    for (const rule of results) {
      let keywords = [];
      try { 
        keywords = typeof rule.keywords === "string" ? JSON.parse(rule.keywords || "[]") : (rule.keywords || []);
      } catch(e) {}
      const matchType = rule.match_type || "exact";
      let match = false;
      if (matchType === "exact") {
        match = keywords.some(k => k.toLowerCase() === lowerMsg);
      } else {
        match = keywords.some(k => lowerMsg.includes(k.toLowerCase()));
      }
      if (match) return rule.reply_message || null;
    }
  } catch (err) {
    console.error("Error in findMatchingRule:", err);
  }
  return null;
}

async function findEventRule(env, eventType) {
  try {
    if (!env.DB) return null;
    await ensureD1Tables(env.DB);
    const rule = await env.DB.prepare(
      "SELECT reply_message FROM rules WHERE is_active = 1 AND trigger_type = ? LIMIT 1"
    ).bind(eventType).first();
    return rule ? rule.reply_message : null;
  } catch(e) {
    console.error("Error in findEventRule:", e);
  }
  return null;
}

async function getEmployeeProfile(env, employeeCode) {
  const result = { name: employeeCode, email: "" };
  try {
    const token = await getAccessToken(env);
    const res = await fetch(`${SEATALK_API}/contacts/v2/profile?employee_code=${employeeCode}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.code === 0 && data.employees?.length > 0) {
      const emp = data.employees[0];
      result.name = emp.en_name || emp.name || employeeCode;
      result.email = emp.company_email || emp.email || "";
    }
  } catch(e) {}
  return result;
}

async function sendPrivateMessage(env, employeeCode, text, messageObj, threadId) {
  const token = await getAccessToken(env);
  const resolvedCode = await resolveEmployeeCode(env, employeeCode);
  const messageData = messageObj ? JSON.parse(JSON.stringify(messageObj)) : { tag: "text", text: { content: text } };
  if (threadId) {
    messageData.thread_id = threadId;
    messageData.quoted_message_id = threadId; 
  }
  const res = await fetch(`${SEATALK_API}/messaging/v2/single_chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ employee_code: resolvedCode, message: messageData }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`SeaTalk API Error: ${JSON.stringify(data)}`);
}

async function sendGroupMessage(env, groupId, text, threadId, messageObj) {
  const token = await getAccessToken(env);
  const messageData = messageObj ? JSON.parse(JSON.stringify(messageObj)) : { tag: "text", text: { content: text } };
  if (threadId) {
    messageData.thread_id = threadId;
    messageData.quoted_message_id = threadId; 
  }
  const body = { group_id: groupId, message: messageData };
  const res = await fetch(`${SEATALK_API}/messaging/v2/group_chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`SeaTalk API Error: ${JSON.stringify(data)}`);
}

async function ensureConversation(env, info) {
  const convId = info.chat_type === "group" ? info.group_id : info.employee_code;
  if (!convId) return "";
  try {
    if (!env.DB) return convId;
    await ensureD1Tables(env.DB);
    
    const existing = await env.DB.prepare(
      "SELECT id FROM conversations WHERE id = ?"
    ).bind(convId).first();
    
    if (!existing) {
      await env.DB.prepare(
        "INSERT INTO conversations (id, chat_type, employee_code, group_id, group_name, user_name, user_email, last_message_time, unread_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        convId,
        info.chat_type,
        info.employee_code || "",
        info.group_id || "",
        info.group_name || "",
        info.user_name || "",
        info.user_email || "",
        new Date().toISOString(),
        0,
        "active"
      ).run();
    }
  } catch(e) {
    console.error("Error in ensureConversation:", e);
  }
  return convId;
}

async function saveMessage(env, convId, info) {
  try {
    if (!env.DB) return;
    await ensureD1Tables(env.DB);
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    
    await env.DB.prepare(
      "INSERT INTO messages (id, conversation_id, message_id, sender, sender_name, content, tag, employee_code, group_id, is_auto_reply, sent_at, thread_id, quoted_message_id, raw_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id,
      String(convId),
      info.message_id || id,
      info.sender,
      info.sender_name || "",
      info.content || "",
      info.tag || "text",
      info.employee_code || "",
      info.group_id || "",
      info.is_auto_reply ? 1 : 0,
      new Date().toISOString(),
      info.thread_id || "",
      info.quoted_message_id || "",
      info.raw_message || ""
    ).run();

    let updateQuery = "UPDATE conversations SET last_message = ?, last_message_time = ? WHERE id = ?";
    if (info.sender === "user") {
      updateQuery = "UPDATE conversations SET last_message = ?, last_message_time = ?, unread_count = unread_count + 1 WHERE id = ?";
    }
    await env.DB.prepare(updateQuery).bind(
      info.content || "",
      new Date().toISOString(),
      String(convId)
    ).run();
  } catch(e) {
    console.error("Error in saveMessage:", e);
  }
}

async function getMessageByMessageId(env, messageId) {
  try {
    if (!env.DB) return null;
    await ensureD1Tables(env.DB);
    const row = await env.DB.prepare(
      "SELECT * FROM messages WHERE message_id = ?"
    ).bind(messageId).first();
    
    if (row) {
      return {
        fields: {
          thread_id: { stringValue: row.thread_id || "" },
          raw_message: { stringValue: row.raw_message || row.content || "" }
        }
      };
    }
  } catch (err) {
    console.error("Error in getMessageByMessageId:", err);
  }
  return null;
}

function parseReplyMessage(reply) {
  if (!reply) return { text: "", messageObj: undefined };
  let messageObj = undefined;
  let text = reply;
  try {
    const trimmed = reply.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.tag) {
        messageObj = parsed;
        if (parsed.tag === "interactive_message") text = "[Interactive Message]";
        else if (parsed.tag === "image") text = "[Image]";
        else if (parsed.tag === "file") text = `[File]`;
        else if (parsed.tag === "text") text = parsed.text?.content || reply;
      }
    }
  } catch(e) {}
  return { text, messageObj };
}

async function runScheduledBroadcasts(env) {
  try {
    if (!env.DB) return;
    await ensureD1Tables(env.DB);
    const { results } = await env.DB.prepare(
      "SELECT * FROM broadcasts WHERE status = 'pending' OR status = 'scheduled'"
    ).all();
    
    const now = new Date();
    // Use UTC+8 for Manila/Singapore standard time
    const offset = 8 * 60 * 60 * 1000;
    const localNow = new Date(now.getTime() + offset);
    const dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][localNow.getUTCDay()];
    const currentHourStr = localNow.getUTCHours().toString().padStart(2, "0");
    const currentMinStr = localNow.getUTCMinutes().toString().padStart(2, "0");
    const currentTimeStr = `${currentHourStr}:${currentMinStr}`;
    const localNowDateStr = localNow.toISOString().split("T")[0];

    for (const b of results) {
      let isDue = false;
      const sched = b.scheduled_at;
      const isDaily = sched && sched.length === 5 && sched.includes(":");
      const isWeekly = sched && sched.includes("T") && sched.length < 15;
      const isRecurring = isDaily || isWeekly;

      // If it's recurring, verify it hasn't already been sent today
      if (isRecurring && b.sent_at) {
        try {
          const lastSentLocal = new Date(new Date(b.sent_at).getTime() + offset);
          const lastSentDateStr = lastSentLocal.toISOString().split("T")[0];
          if (lastSentDateStr === localNowDateStr) {
            // Already sent today, skip
            continue;
          }
        } catch (e) {
          console.error("Error parsing sent_at:", e);
        }
      }

      if (!sched || sched === "immediate") {
        isDue = true;
      } else if (isDaily) {
        isDue = currentTimeStr >= sched;
      } else if (isWeekly) {
        const parts = sched.split("T");
        if (parts.length === 2 && dayOfWeek === parts[0] && currentTimeStr >= parts[1]) {
          isDue = true;
        }
      } else if (sched.length >= 15) {
        // ISO string fallback
        isDue = now >= new Date(sched);
      }

      if (!isDue) continue;

      try {
        let payloadObj = undefined;
        let text = b.content;
        try {
          const parsed = JSON.parse(b.content);
          if (parsed && typeof parsed === "object" && parsed.tag) {
            payloadObj = parsed;
            text = "Scheduled message";
          }
        } catch(e) {}
        
        if (b.target_type === "private") {
          await sendPrivateMessage(env, b.target_value, text, payloadObj);
        } else {
          await sendGroupMessage(env, b.target_value, text, undefined, payloadObj);
        }
        
        if (isRecurring) {
          await env.DB.prepare(
            "UPDATE broadcasts SET sent_at = ? WHERE id = ?"
          ).bind(now.toISOString(), b.id).run();
        } else {
          await env.DB.prepare(
            "UPDATE broadcasts SET status = 'sent', sent_at = ? WHERE id = ?"
          ).bind(now.toISOString(), b.id).run();
        }
        
        await logEvent(env, "info", `Successfully dispatched scheduled broadcast: ${b.title}`, { id: b.id });
      } catch (err) {
        if (isRecurring) {
          await env.DB.prepare(
            "UPDATE broadcasts SET sent_at = ? WHERE id = ?"
          ).bind(now.toISOString(), b.id).run(); // record execution attempt to prevent retrying constantly today
        } else {
          await env.DB.prepare(
            "UPDATE broadcasts SET status = 'failed' WHERE id = ?"
          ).bind(b.id).run();
        }
        await logEvent(env, "error", `Failed to dispatch scheduled broadcast: ${b.title}`, { id: b.id, error: err.toString() });
      }
    }
  } catch (e) {
    console.error("Error running scheduled broadcasts:", e);
  }
}

async function callCloudflareAI(env, messageText) {
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
      await logEvent(env, "info", `Attempting Cloudflare AI inference`, { model, messageText });
      
      const aiResponse = await aiBinding.run(model, {
        messages: [
          { 
            role: "system", 
            content: `You are a friendly, helpful conversational bot. Answer any questions clearly and concisely. You can use markdown formatting.`
          },
          { 
            role: "user", 
            content: messageText 
          }
        ]
      });
      
      await logEvent(env, "info", "AI Response Raw", { aiResponse });
      const responseText = aiResponse.response || (aiResponse.result && aiResponse.result.response) || aiResponse.text;
      if (responseText) {
        return responseText;
      }
    } catch (err) {
      console.error(`AI Model ${model} Error:`, err);
      lastError = err;
      await logEvent(env, "warning", `AI Model ${model} failed, trying next fallback`, {
        error: err.toString(),
        message: err.message
      });
    }
  }

  await logEvent(env, "error", "All Cloudflare AI model attempts failed", {
    error: lastError ? lastError.toString() : "Unknown error"
  });
  return `⚠️ AI Assistant error: Failed to generate response (${lastError ? lastError.message : "Unknown error"}). Please ensure your Workers AI limits/subscription are active.`;
}

// --- Event Handlers ---
export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);

    try {
      // --- GET / HTML Diagnostics Dashboard ---
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || !url.pathname.startsWith("/api"))) {
        const hasAppId = !!env.SEATALK_APP_ID;
        const hasAppSecret = !!env.SEATALK_APP_SECRET;
        const hasD1 = !!env.DB;
        const hasAi = !!(env.AI || env.ai || env.WorkersAI || env.workers_ai);
        
        const html = `<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SBM - SeaTalk Bot Diagnostics Console</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Inter', sans-serif;
        }
        .font-mono {
            font-family: 'JetBrains Mono', monospace;
        }
        .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
            background: rgba(15, 23, 42, 0.6);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(148, 163, 184, 0.3);
            border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(148, 163, 184, 0.5);
        }
    </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-full flex flex-col justify-between selection:bg-teal-500/30 selection:text-teal-200">
    
    <!-- Header -->
    <header class="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div class="flex items-center space-x-3">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-teal-500/10">
                    <span class="text-xl">🤖</span>
                </div>
                <div>
                    <h1 class="text-lg font-bold tracking-tight text-white font-mono flex items-center gap-2">
                        SEATALK_BOT_MANAGER
                        <span class="inline-flex items-center rounded-md bg-teal-500/10 px-2 py-1 text-xs font-mono font-medium text-teal-400 ring-1 ring-inset ring-teal-500/20">v2.1.0</span>
                    </h1>
                    <p class="text-xs text-slate-400">Cloudflare Webhook Gateway & Diagnostics Portal</p>
                </div>
            </div>
            <div class="flex items-center space-x-4">
                <div class="flex items-center space-x-2">
                    <span class="relative flex h-2.5 w-2.5">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-teal-500"></span>
                    </span>
                    <span class="text-xs font-mono text-slate-300">Gateway Online</span>
                </div>
            </div>
        </div>
    </header>

    <!-- Main Content Grid -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        <!-- Left Panel: Diagnostics & Env Variables (5 Cols) -->
        <div class="lg:col-span-5 flex flex-col space-y-8">
            
            <!-- Env Binding Status -->
            <section class="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-xl shadow-black/40">
                <div class="flex items-center justify-between mb-6">
                    <h2 class="text-sm font-semibold tracking-wider text-slate-400 uppercase font-mono">Environment Configuration</h2>
                    <span class="text-xs text-slate-500">Auto-detected from Cloudflare</span>
                </div>
                
                <div class="space-y-4">
                    <!-- SeaTalk Variables -->
                    <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-900 flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium text-slate-200 font-mono">SEATALK_APP_ID</p>
                            <p class="text-xs text-slate-500">SeaTalk Open Platform identifier</p>
                        </div>
                        <div>
                            ${hasAppId 
                                ? `<span class="inline-flex items-center gap-x-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">✅ Bound</span>`
                                : `<span class="inline-flex items-center gap-x-1.5 rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400 ring-1 ring-inset ring-rose-500/20">❌ Missing</span>`
                            }
                        </div>
                    </div>

                    <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-900 flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium text-slate-200 font-mono">SEATALK_APP_SECRET</p>
                            <p class="text-xs text-slate-500">SeaTalk Authorization Secret key</p>
                        </div>
                        <div>
                            ${hasAppSecret 
                                ? `<span class="inline-flex items-center gap-x-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">✅ Bound</span>`
                                : `<span class="inline-flex items-center gap-x-1.5 rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400 ring-1 ring-inset ring-rose-500/20">❌ Missing</span>`
                            }
                        </div>
                    </div>

                    <!-- D1 Database Binding -->
                    <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-900 flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium text-slate-200 font-mono">D1 DATABASE (DB)</p>
                            <p class="text-xs text-slate-500">Cloudflare D1 SQL database binding</p>
                        </div>
                        <div>
                            ${hasD1 
                                ? `<span class="inline-flex items-center gap-x-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">✅ Bound</span>`
                                : `<span class="inline-flex items-center gap-x-1.5 rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400 ring-1 ring-inset ring-rose-500/20">❌ Missing Binding 'DB'</span>`
                            }
                        </div>
                    </div>

                    <!-- Cloudflare AI Binding -->
                    <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-900 flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium text-slate-200 font-mono">Workers AI (AI)</p>
                            <p class="text-xs text-slate-500">Cloudflare Edge AI Binding</p>
                        </div>
                        <div>
                            ${hasAi 
                                ? `<span class="inline-flex items-center gap-x-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">✅ Active Binding</span>`
                                : `<span class="inline-flex items-center gap-x-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">⚠️ Bind AI</span>`
                            }
                        </div>
                    </div>
                </div>
            </section>

            <!-- Diagnostic Connection Tests -->
            <section class="bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-xl shadow-black/40 flex-1 flex flex-col justify-between">
                <div>
                    <h2 class="text-sm font-semibold tracking-wider text-slate-400 uppercase font-mono mb-6">Gateway Diagnostics Suite</h2>
                    
                    <div class="space-y-4">
                        <!-- Test SeaTalk API -->
                        <div>
                            <button onclick="runDiagnostic('seatalk')" id="btn-seatalk" class="w-full flex items-center justify-between px-4 py-3 bg-slate-950/80 hover:bg-slate-900 border border-slate-800 rounded-xl transition duration-200 group">
                                <div class="flex items-center space-x-3 text-left">
                                    <span class="text-base text-slate-400 group-hover:text-teal-400 transition">💬</span>
                                    <div>
                                        <p class="text-sm font-medium text-slate-200">Test SeaTalk App Auth</p>
                                        <p class="text-xs text-slate-500">Acquire active OAuth token from SeaTalk Open API</p>
                                    </div>
                                </div>
                                <span class="text-xs text-teal-400 hover:underline font-mono">Run Test →</span>
                            </button>
                            <div id="result-seatalk" class="hidden mt-2 p-3 bg-slate-950 rounded-lg text-xs font-mono border border-slate-900/80 overflow-auto"></div>
                        </div>

                        <!-- Test D1 Connection -->
                        <div>
                            <button onclick="runDiagnostic('d1')" id="btn-d1" class="w-full flex items-center justify-between px-4 py-3 bg-slate-950/80 hover:bg-slate-900 border border-slate-800 rounded-xl transition duration-200 group">
                                <div class="flex items-center space-x-3 text-left">
                                    <span class="text-base text-slate-400 group-hover:text-teal-400 transition">🛢️</span>
                                    <div>
                                        <p class="text-sm font-medium text-slate-200">Test D1 Database</p>
                                        <p class="text-xs text-slate-500">Verify SQLite schema tables and run query on D1 database</p>
                                    </div>
                                </div>
                                <span class="text-xs text-teal-400 hover:underline font-mono">Run Test →</span>
                            </button>
                            <div id="result-d1" class="hidden mt-2 p-3 bg-slate-950 rounded-lg text-xs font-mono border border-slate-900/80 overflow-auto"></div>
                        </div>

                        <!-- Test Workers AI -->
                        <div>
                            <button onclick="runDiagnostic('ai')" id="btn-ai" class="w-full flex items-center justify-between px-4 py-3 bg-slate-950/80 hover:bg-slate-900 border border-slate-800 rounded-xl transition duration-200 group">
                                <div class="flex items-center space-x-3 text-left">
                                    <span class="text-base text-slate-400 group-hover:text-teal-400 transition">⚡</span>
                                    <div>
                                        <p class="text-sm font-medium text-slate-200">Test Workers AI Binding</p>
                                        <p class="text-xs text-slate-500">Execute quick inference using llama-3.2-1b</p>
                                    </div>
                                </div>
                                <span class="text-xs text-teal-400 hover:underline font-mono">Run Test →</span>
                            </button>
                            <div id="result-ai" class="hidden mt-2 p-3 bg-slate-950 rounded-lg text-xs font-mono border border-slate-900/80 overflow-auto"></div>
                        </div>
                    </div>
                </div>

                <div class="mt-8 border-t border-slate-900 pt-6">
                    <p class="text-xs text-slate-500 leading-relaxed">
                        ⚠️ <strong>Config Instructions:</strong> Webhook callback URL in your SeaTalk Developer Portal must be configured to this Worker's address. Your admin portal website connects securely directly to your Cloudflare Worker REST endpoints.
                    </p>
                </div>
            </section>
        </div>

        <!-- Right Panel: Live Logs Console (7 Cols) -->
        <div class="lg:col-span-7 flex flex-col min-h-[600px] bg-slate-900/40 border border-slate-800/80 backdrop-blur-md rounded-2xl p-6 shadow-xl shadow-black/40">
            <div class="flex items-center justify-between mb-6">
                <div class="flex items-center space-x-3">
                    <div class="w-2.5 h-2.5 rounded-full bg-teal-500 animate-pulse"></div>
                    <h2 class="text-sm font-semibold tracking-wider text-slate-400 uppercase font-mono">Live System Logs Console</h2>
                </div>
                <button onclick="fetchLogs()" id="btn-refresh" class="inline-flex items-center gap-x-1.5 rounded-xl bg-slate-950 hover:bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-sm border border-slate-800 transition">
                    🔄 Refresh Console
                </button>
            </div>

            <!-- Terminal Area -->
            <div class="flex-1 bg-slate-950 rounded-2xl border border-slate-900 flex flex-col overflow-hidden font-mono text-xs">
                <!-- Terminal Header Bar -->
                <div class="flex items-center justify-between px-4 py-2 border-b border-slate-900 bg-slate-950/50">
                    <div class="flex space-x-1.5">
                        <span class="w-2.5 h-2.5 rounded-full bg-rose-500/60"></span>
                        <span class="w-2.5 h-2.5 rounded-full bg-amber-500/60"></span>
                        <span class="w-2.5 h-2.5 rounded-full bg-teal-500/60"></span>
                    </div>
                    <span class="text-[10px] text-slate-500 font-mono">active_session@seatalk_gateway</span>
                </div>

                <!-- Terminal Body Scroll -->
                <div id="logs-container" class="flex-1 p-4 overflow-y-auto space-y-3 custom-scrollbar">
                    <div class="text-slate-500 italic">Initializing console connection...</div>
                </div>
            </div>
        </div>
    </main>

    <!-- Footer -->
    <footer class="border-t border-slate-900 py-6 mt-12 bg-slate-950/40">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col sm:flex-row items-center justify-between gap-4">
            <p class="text-xs text-slate-500">© 2026 Shopee Choice CS Solutions. Serviced via Cloudflare Network Edge.</p>
            <div class="flex items-center space-x-4">
                <a href="/api/dashboard/contacts" target="_blank" class="text-xs text-slate-400 hover:text-white font-mono">Contacts API →</a>
                <span class="text-slate-700">|</span>
                <span class="text-xs text-slate-500 font-mono">Region: Global Edge</span>
            </div>
        </div>
    </footer>

    <!-- Scripts -->
    <script>
        async function runDiagnostic(type) {
            const btn = document.getElementById('btn-' + type);
            const resBox = document.getElementById('result-' + type);
            
            resBox.classList.remove('hidden');
            resBox.className = "mt-2 p-3 bg-slate-950 rounded-lg text-xs font-mono border border-slate-900/80 overflow-auto text-slate-400 animate-pulse";
            resBox.innerText = "⏳ Executing connection sequence...";
            
            try {
                const res = await fetch('/api/diagnose/' + type);
                const data = await res.json();
                
                resBox.classList.remove('animate-pulse');
                if (data.success) {
                    resBox.className = "mt-2 p-3 bg-emerald-950/30 text-emerald-400 rounded-lg text-xs font-mono border border-emerald-500/20 overflow-auto";
                    resBox.innerText = "✅ " + data.message + (data.token ? "\\nToken Prefix: " + data.token : "") + (data.rules_count !== undefined ? "\\nFound active rules: " + data.rules_count : "");
                } else {
                    resBox.className = "mt-2 p-3 bg-rose-950/30 text-rose-400 rounded-lg text-xs font-mono border border-rose-500/20 overflow-auto";
                    resBox.innerText = "❌ Error: " + data.message;
                }
            } catch (err) {
                resBox.classList.remove('animate-pulse');
                resBox.className = "mt-2 p-3 bg-rose-950/30 text-rose-400 rounded-lg text-xs font-mono border border-rose-500/20 overflow-auto";
                resBox.innerText = "❌ Network Request Failed: " + err.message;
            }
        }

        async function fetchLogs() {
            const container = document.getElementById('logs-container');
            const btn = document.getElementById('btn-refresh');
            btn.innerText = "⏳ Loading...";
            btn.disabled = true;

            try {
                const res = await fetch('/api/diagnose/logs');
                const data = await res.json();
                
                btn.innerText = "🔄 Refresh Console";
                btn.disabled = false;

                if (!data.success || !data.logs || data.logs.length === 0) {
                    container.innerHTML = '<div class="text-slate-500 py-4 italic text-center">No logs recorded yet. Webhooks processed by this worker will emit diagnostic logs here.</div>';
                    return;
                }

                container.innerHTML = '';
                data.logs.forEach((log, index) => {
                    const row = document.createElement('div');
                    row.className = "border-b border-slate-900/60 pb-3 last:border-0";
                    
                    let levelBadge = '';
                    if (log.level === 'error') {
                        levelBadge = '<span class="px-1.5 py-0.5 bg-rose-500/10 text-rose-400 rounded ring-1 ring-inset ring-rose-500/20 mr-2 text-[10px] font-bold">ERROR</span>';
                    } else if (log.level === 'warning') {
                        levelBadge = '<span class="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded ring-1 ring-inset ring-amber-500/20 mr-2 text-[10px] font-bold">WARN</span>';
                    } else {
                        levelBadge = '<span class="px-1.5 py-0.5 bg-teal-500/10 text-teal-400 rounded ring-1 ring-inset ring-teal-500/20 mr-2 text-[10px] font-bold">INFO</span>';
                    }

                    const formattedTime = new Date(log.timestamp).toLocaleTimeString();
                    
                    let detailsHtml = '';
                    if (log.details && log.details !== '{}') {
                        const detailsId = 'details-' + index;
                        detailsHtml = \`
                            <div class="mt-1">
                                <button onclick="toggleDetails('\${detailsId}')" class="text-[10px] text-teal-500 hover:underline cursor-pointer select-none">View trace details [+]</button>
                                <pre id="\${detailsId}" class="hidden mt-1 p-2 bg-slate-900 rounded border border-slate-800 text-[10px] text-slate-400 whitespace-pre-wrap overflow-x-auto">\${JSON.stringify(JSON.parse(log.details), null, 2)}</pre>
                            </div>
                        \`;
                    }

                    row.innerHTML = \`
                        <div class="flex items-start justify-between text-[11px] text-slate-500 mb-1">
                            <span class="font-mono">\${formattedTime}</span>
                            <span class="font-mono opacity-60 text-[9px]">\${new Date(log.timestamp).toLocaleDateString()}</span>
                        </div>
                        <div class="text-slate-200 leading-relaxed font-mono text-xs flex items-start">
                            \${levelBadge}
                            <span class="flex-1">\${log.message}</span>
                        </div>
                        \${detailsHtml}
                    \`;
                    container.appendChild(row);
                });
            } catch (err) {
                btn.innerText = "🔄 Refresh Console";
                btn.disabled = false;
                container.innerHTML = \`<div class="text-rose-400 text-center py-4">❌ Failed to fetch logs: \${err.message}</div>\`;
            }
        }

        function toggleDetails(id) {
            const el = document.getElementById(id);
            if (el.classList.contains('hidden')) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        }

        // Load logs initially
        window.addEventListener('DOMContentLoaded', fetchLogs);
    </script>
</body>
</html>`;
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders }
        });
      }

      // --- NEW: /api/diagnose/seatalk Endpoint ---
      if (url.pathname === "/api/diagnose/seatalk" && request.method === "GET") {
        try {
          const token = await getAccessToken(env);
          return new Response(JSON.stringify({ 
            success: true, 
            message: "Successfully retrieved SeaTalk access token from Open API!",
            token: token ? token.substring(0, 10) + "..." : null 
          }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ 
            success: false, 
            message: `SeaTalk APP_ID/SECRET Validation Failed: ${err.message}` 
          }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // --- NEW: /api/diagnose/d1 Endpoint ---
      if (url.pathname === "/api/diagnose/d1" && request.method === "GET") {
        try {
          if (!env.DB) {
            return new Response(JSON.stringify({ 
              success: false, 
              message: "Cloudflare D1 database binding 'DB' is missing from env configuration." 
            }), {
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
          await ensureD1Tables(env.DB);
          
          const rulesCountRes = await env.DB.prepare("SELECT COUNT(*) as count FROM rules").first();
          const rules_count = rulesCountRes ? rulesCountRes.count : 0;
          
          return new Response(JSON.stringify({ 
            success: true, 
            message: "Successfully synchronized with Cloudflare D1 SQL database!",
            rules_count: rules_count
          }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ 
            success: false, 
            message: `D1 connection/query sequence aborted: ${err.message || err.toString()}` 
          }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // --- NEW: /api/diagnose/ai Endpoint ---
      if (url.pathname === "/api/diagnose/ai" && request.method === "GET") {
        try {
          const aiBinding = env.AI || env.ai || env.WorkersAI || env.workers_ai;
          if (!aiBinding) {
            return new Response(JSON.stringify({ 
              success: false, 
              message: "Workers AI service binding 'AI' is not declared on this worker. Add it under Worker Settings > Variables > AI Bindings." 
            }), {
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
          
          const responseText = await callCloudflareAI(env, "What is the restock schedule for a sold-out item according to the SOP?");
          
          if (responseText) {
            return new Response(JSON.stringify({ 
              success: true, 
              message: `Workers AI is working correctly! Model response: "${responseText.trim()}"` 
            }), {
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          } else {
            return new Response(JSON.stringify({ 
              success: false, 
              message: "Workers AI returned empty response."
            }), {
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
        } catch (err) {
          return new Response(JSON.stringify({ 
            success: false, 
            message: `Workers AI execution failed: ${err.message || err.toString()}` 
          }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // --- NEW: /api/diagnose/logs Endpoint ---
      if (url.pathname === "/api/diagnose/logs" && request.method === "GET") {
        try {
          if (!env.DB) {
            return new Response(JSON.stringify({ success: true, logs: [] }), {
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
          await ensureD1Tables(env.DB);
          const { results } = await env.DB.prepare(
            "SELECT * FROM logs ORDER BY timestamp DESC LIMIT 30"
          ).all();
          
          return new Response(JSON.stringify({ success: true, logs: results || [] }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, message: `Failed fetching logs: ${err.message || err.toString()}` }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // --- D1 REST API Endpoints for React Frontend ---

      // 1. GET /api/dashboard/conversations
      if (url.pathname === "/api/dashboard/conversations" && request.method === "GET") {
        try {
          await ensureD1Tables(env.DB);
          const { results } = await env.DB.prepare(
            "SELECT * FROM conversations ORDER BY last_message_time DESC"
          ).all();
          return new Response(JSON.stringify({ success: true, data: results || [] }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 2. GET /api/dashboard/conversations/:id/messages
      if (url.pathname.startsWith("/api/dashboard/conversations/") && url.pathname.endsWith("/messages") && request.method === "GET") {
        try {
          await ensureD1Tables(env.DB);
          const pathParts = url.pathname.split("/");
          const convId = pathParts[4]; // ["", "api", "dashboard", "conversations", ":id", "messages"]
          
          const { results } = await env.DB.prepare(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC"
          ).bind(convId).all();
          
          // Also set unread count to 0 when opened
          await env.DB.prepare(
            "UPDATE conversations SET unread_count = 0 WHERE id = ?"
          ).bind(convId).run();

          return new Response(JSON.stringify({ success: true, data: results || [] }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 3. POST /api/dashboard/conversations/:id/mark-read
      if (url.pathname.startsWith("/api/dashboard/conversations/") && url.pathname.endsWith("/mark-read") && request.method === "POST") {
        try {
          await ensureD1Tables(env.DB);
          const pathParts = url.pathname.split("/");
          const convId = pathParts[4];
          
          await env.DB.prepare(
            "UPDATE conversations SET unread_count = 0 WHERE id = ?"
          ).bind(convId).run();

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 4. DELETE /api/dashboard/conversations/:id
      if (url.pathname.startsWith("/api/dashboard/conversations/") && !url.pathname.endsWith("/messages") && !url.pathname.endsWith("/mark-read") && request.method === "DELETE") {
        try {
          await ensureD1Tables(env.DB);
          const pathParts = url.pathname.split("/");
          const convId = pathParts[4];
          
          // Delete conversation and messages
          await env.DB.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(convId).run();
          await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(convId).run();

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 5. GET /api/dashboard/rules
      if (url.pathname === "/api/dashboard/rules" && request.method === "GET") {
        try {
          await ensureD1Tables(env.DB);
          const { results } = await env.DB.prepare(
            "SELECT * FROM rules ORDER BY priority DESC"
          ).all();
          
          // Format rules to match old Firestore client layout: parsed keywords array
          const formatted = (results || []).map(r => {
            let kwArr = [];
            try {
              if (r.keywords) {
                kwArr = JSON.parse(r.keywords);
              }
            } catch {}
            return {
              ...r,
              keywords: kwArr,
              is_active: r.is_active === 1
            };
          });

          return new Response(JSON.stringify({ success: true, data: formatted }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 6. POST /api/dashboard/rules
      if (url.pathname === "/api/dashboard/rules" && request.method === "POST") {
        try {
          await ensureD1Tables(env.DB);
          const body = await request.json();
          const { trigger_type, keywords, match_type, reply_message, is_active, priority } = body;
          
          const ruleId = "rule_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
          const kwStr = Array.isArray(keywords) ? JSON.stringify(keywords) : "[]";
          const activeVal = is_active === true || is_active === 1 ? 1 : 0;
          const priorityVal = priority || 0;

          await env.DB.prepare(`
            INSERT INTO rules (id, trigger_type, keywords, match_type, reply_message, is_active, priority)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).bind(ruleId, trigger_type, kwStr, match_type || "contains", reply_message || "", activeVal, priorityVal).run();

          return new Response(JSON.stringify({ success: true, id: ruleId }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 7. PUT /api/dashboard/rules/:id
      if (url.pathname.startsWith("/api/dashboard/rules/") && request.method === "PUT") {
        try {
          await ensureD1Tables(env.DB);
          const pathParts = url.pathname.split("/");
          const ruleId = pathParts[4];
          const body = await request.json();
          const { trigger_type, keywords, match_type, reply_message, is_active, priority } = body;
          
          const kwStr = Array.isArray(keywords) ? JSON.stringify(keywords) : "[]";
          const activeVal = is_active === true || is_active === 1 ? 1 : 0;
          const priorityVal = priority || 0;

          await env.DB.prepare(`
            UPDATE rules 
            SET trigger_type = ?, keywords = ?, match_type = ?, reply_message = ?, is_active = ?, priority = ?
            WHERE id = ?
          `).bind(trigger_type, kwStr, match_type || "contains", reply_message || "", activeVal, priorityVal, ruleId).run();

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 8. DELETE /api/dashboard/rules/:id
      if (url.pathname.startsWith("/api/dashboard/rules/") && request.method === "DELETE") {
        try {
          await ensureD1Tables(env.DB);
          const pathParts = url.pathname.split("/");
          const ruleId = pathParts[4];
          
          await env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(ruleId).run();

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 9. GET /api/dashboard/logs
      if (url.pathname === "/api/dashboard/logs" && request.method === "GET") {
        try {
          await ensureD1Tables(env.DB);
          const { results } = await env.DB.prepare(
            "SELECT * FROM logs ORDER BY timestamp DESC LIMIT 200"
          ).all();
          return new Response(JSON.stringify({ success: true, data: results || [] }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 10. POST /api/dashboard/logs
      if (url.pathname === "/api/dashboard/logs" && request.method === "POST") {
        try {
          await ensureD1Tables(env.DB);
          const body = await request.json();
          const { level, message, details } = body;
          
          await logEvent(env, level || "info", message || "", details || {});
          
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 11. DELETE /api/dashboard/logs
      if (url.pathname === "/api/dashboard/logs" && request.method === "DELETE") {
        try {
          await ensureD1Tables(env.DB);
          await env.DB.prepare("DELETE FROM logs").run();
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 12. GET /api/dashboard/settings
      if (url.pathname === "/api/dashboard/settings" && request.method === "GET") {
        try {
          await ensureD1Tables(env.DB);
          const { results } = await env.DB.prepare("SELECT * FROM settings").all();
          
          // Convert row array into a clean key-value object
          const settingsObj = {};
          if (results) {
            for (const r of results) {
              try {
                settingsObj[r.key] = JSON.parse(r.value);
              } catch {
                settingsObj[r.key] = r.value;
              }
            }
          }
          
          return new Response(JSON.stringify({ success: true, data: settingsObj }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 13. POST /api/dashboard/settings
      if (url.pathname === "/api/dashboard/settings" && request.method === "POST") {
        try {
          await ensureD1Tables(env.DB);
          const body = await request.json();
          const { key, value } = body;
          
          const valStr = typeof value === "object" ? JSON.stringify(value) : String(value);
          
          await env.DB.prepare(`
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
          `).bind(key, valStr).run();

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 14. GET /api/dashboard/broadcasts
      if (url.pathname === "/api/dashboard/broadcasts" && request.method === "GET") {
        try {
          await ensureD1Tables(env.DB);
          const { results } = await env.DB.prepare(
            "SELECT * FROM broadcasts ORDER BY created_at DESC"
          ).all();
          return new Response(JSON.stringify({ success: true, data: results || [] }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 15. POST /api/dashboard/broadcasts
      if (url.pathname === "/api/dashboard/broadcasts" && request.method === "POST") {
        try {
          await ensureD1Tables(env.DB);
          const body = await request.json();
          const { title, content, target_type, target_value, status, scheduled_at } = body;
          
          const bId = "broad_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
          const cAt = new Date().toISOString();

          await env.DB.prepare(`
            INSERT INTO broadcasts (id, title, content, target_type, target_value, status, scheduled_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(bId, title || "", content || "", target_type || "all", target_value || "", status || "draft", scheduled_at || "", cAt).run();

          return new Response(JSON.stringify({ success: true, id: bId }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 16. PUT /api/dashboard/broadcasts/:id
      if (url.pathname.startsWith("/api/dashboard/broadcasts/") && request.method === "PUT") {
        try {
          await ensureD1Tables(env.DB);
          const pathParts = url.pathname.split("/");
          const broadcastId = pathParts[4];
          const body = await request.json();
          const { title, content, target_type, target_value, status, scheduled_at } = body;

          await env.DB.prepare(`
            UPDATE broadcasts 
            SET title = ?, content = ?, target_type = ?, target_value = ?, status = ?, scheduled_at = ?
            WHERE id = ?
          `).bind(title, content, target_type, target_value, status, scheduled_at, broadcastId).run();

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 17. DELETE /api/dashboard/broadcasts/:id
      if (url.pathname.startsWith("/api/dashboard/broadcasts/") && request.method === "DELETE") {
        try {
          await ensureD1Tables(env.DB);
          const pathParts = url.pathname.split("/");
          const broadcastId = pathParts[4];
          
          await env.DB.prepare("DELETE FROM broadcasts WHERE id = ?").bind(broadcastId).run();

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 18. DELETE /api/dashboard/messages/:id
      if (url.pathname.startsWith("/api/dashboard/messages/") && request.method === "DELETE") {
        try {
          await ensureD1Tables(env.DB);
          const pathParts = url.pathname.split("/");
          const messageId = pathParts[4];
          
          await env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(messageId).run();

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      // 18.0 PUT /api/dashboard/messages/:id
      if (url.pathname.startsWith("/api/dashboard/messages/") && request.method === "PUT") {
        try {
          await ensureD1Tables(env.DB);
          const pathParts = url.pathname.split("/");
          const messageId = pathParts[4];
          const bodyText = await request.text();
          let body;
          try {
            body = JSON.parse(bodyText);
          } catch {
            body = {};
          }
          
          await env.DB.prepare("UPDATE messages SET raw_message = ? WHERE id = ?")
            .bind(body.raw_message || "", messageId)
            .run();

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
      }

      if (
        url.pathname === "/api/dashboard/contacts" &&
        request.method === "GET"
      ) {
        const token = await getAccessToken(env);

        // 1. Get joined groups
        const joinedRes = await fetch(
          `${SEATALK_API}/messaging/v2/group_chat/joined`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        let groups = [];
        let empCodesToFetch = new Set();

        if (joinedRes.ok) {
          const joinedData = await joinedRes.json();
          const groupIds = joinedData.joined_group_chats?.group_id || [];

          for (const gid of groupIds) {
            // 2. Get group info for each
            const infoRes = await fetch(
              `${SEATALK_API}/messaging/v2/group_chat/info?group_id=${gid}`,
              {
                headers: { Authorization: `Bearer ${token}` },
              },
            );
            if (infoRes.ok) {
              const infoData = await infoRes.json();
              if (infoData.group) {
                groups.push({
                  id: gid,
                  name: infoData.group.group_name || gid,
                  type: "group",
                });

                if (infoData.group.group_user_list) {
                  for (const u of infoData.group.group_user_list) {
                    if (u.employee_code) empCodesToFetch.add(u.employee_code);
                  }
                }
              }
            }
          }
        }

        // Add employee codes from conversations for private chats
        let convInfoByCode = new Map();
        try {
          await ensureD1Tables(env.DB);
          const { results } = await env.DB.prepare(
            "SELECT * FROM conversations"
          ).all();
          if (results) {
            for (const row of results) {
              const code = row.employee_code;
              const uEmail = row.user_email;
              const uName = row.user_name;
              if (code) {
                empCodesToFetch.add(code);
                convInfoByCode.set(code, { email: uEmail, name: uName });
              }
            }
          }
        } catch (err) {
          await logEvent(env, "error", "Failed fetching conversations for contacts", { message: err.message || err.toString() });
        }

        // 3. Batch fetch employee profiles
        const uniqueEmp = [];
        let codesArr = Array.from(empCodesToFetch);

        if (codesArr.length > 0) {
          const profiles = [];
          for (let i = 0; i < codesArr.length; i++) {
            profiles.push({ name: codesArr[i], email: "" });
          }
          
          for (let i = 0; i < codesArr.length; i++) {
            const code = codesArr[i];
            const p = profiles[i];
            const convInfo = convInfoByCode.get(code);
            
            let email = p.email;
            if (!email || email.endsWith("@seatalk.biz")) {
               if (convInfo?.email && !convInfo.email.endsWith("@seatalk.biz")) {
                 email = convInfo.email;
               }
            }
            if (!email) email = "";
            
            let name = p.name;
            if (convInfo?.name && (!name || name === code || name.startsWith("e_"))) {
               name = convInfo.name;
            }
            if (!name) name = code;

            uniqueEmp.push({
              employee_code: code,
              email: email,
              name: name,
              type: "private",
            });
          }
        }

        return new Response(
          JSON.stringify({ success: true, groups, employees: uniqueEmp }),
          {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      if (url.pathname === "/api/dashboard/proxy-file" && request.method === "GET") {
        const fileUrl = url.searchParams.get("url");
        if (!fileUrl) return new Response("Missing url", { status: 400, headers: corsHeaders });
        
        try {
          const token = await getAccessToken(env);
          const res = await fetch(decodeURIComponent(fileUrl), {
            headers: { Authorization: `Bearer ${token}` }
          });
          
          const contentType = res.headers.get("Content-Type") || "application/octet-stream";
          
          return new Response(res.body, {
            status: res.status,
            headers: { ...corsHeaders, "Content-Type": contentType, "Cache-Control": "public, max-age=86400" }
          });
        } catch (e) {
          return new Response("Error proxying file", { status: 500, headers: corsHeaders });
        }
      }

      if (url.pathname === "/api/dashboard/ensure_conversation" && request.method === "POST") {
        const bodyText = await request.text();
        let body;
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = {};
        }

        let convId = await ensureConversation(env, {
          chat_type: body.chat_type,
          employee_code: body.employee_code || "",
          user_name: body.user_name || "",
          user_email: body.user_email || "",
          group_id: body.group_id || "",
          group_name: body.group_name || "",
        });

        return new Response(JSON.stringify({ success: true, conversation_id: convId }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // Endpoint for React App to send messages OUT using the Cloudflare Worker
      if (url.pathname === "/api/dashboard/send" && request.method === "POST") {
        const bodyText = await request.text();
        let body;
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = {};
        }

        if (body.ping) {
          const envChecks = {
            hasProjectId: !!env.FIREBASE_PROJECT_ID,
            hasApiKey: !!env.FIREBASE_API_KEY,
            hasAppId: !!env.SEATALK_APP_ID,
            hasAppSecret: !!env.SEATALK_APP_SECRET,
          };
          let logResult = null;
          if (body.testLog) {
            logResult = await logEvent(
              env,
              "info",
              "Ping with Test Log request",
              envChecks,
            );
          }
          return new Response(
            JSON.stringify({
              success: true,
              message: "pong",
              envChecks,
              logResult,
            }),
            { headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }

        const {
          conversation_id,
          chat_type,
          target_id,
          content,
          user_name,
          user_email,
          group_name,
          message_obj,
          thread_id,
        } = body;

        await logEvent(env, "info", "Dashboard sending message", {
          chat_type,
          target_id,
          content,
          message_obj,
          thread_id,
          conversation_id,
        });

        let actualEmployeeCode = target_id;
        if (chat_type === "private") {
           actualEmployeeCode = await resolveEmployeeCode(env, target_id);
        }

        let convId = conversation_id;
        if (convId && convId.startsWith("new_")) {
          convId = await ensureConversation(env, {
            chat_type,
            employee_code: chat_type === "private" ? actualEmployeeCode : "",
            user_name:
              chat_type === "private"
                ? user_name || user_email || target_id
                : "",
            user_email: chat_type === "private" ? user_email : "",
            group_id: chat_type === "group" ? target_id : "",
            group_name: chat_type === "group" ? group_name || target_id : "",
          });
        }

        if (chat_type === "private") {
          await sendPrivateMessage(env, actualEmployeeCode, content, message_obj, thread_id);
        } else if (chat_type === "group") {
          await sendGroupMessage(env, target_id, content, thread_id, message_obj);
        }

        if (convId) {
          const tag = message_obj?.tag || "text";
          await saveMessage(env, convId, {
            sender: "admin",
            sender_name: "Admin",
            content,
            employee_code: chat_type === "private" ? actualEmployeeCode : "",
            group_id: chat_type === "group" ? target_id : "",
            is_auto_reply: false,
            tag,
            thread_id: thread_id || "",
            quoted_message_id: thread_id || "",
            raw_message: message_obj ? JSON.stringify(message_obj) : ""
          });
        }

        return new Response(
          JSON.stringify({ success: true, conversation_id: convId }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } },
        );
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/" || url.pathname.includes("/seatalk"))
      ) {
        const bodyText = await request.text();
        let body;
        try {
          body = JSON.parse(bodyText);
          await logEvent(env, "info", "Received SeaTalk webhook", {
            event_type: body.event_type,
            event: body.event,
          });
        } catch (e) {
          await logEvent(env, "error", "Failed to parse SeaTalk JSON", {
            body: bodyText,
            error: e.message,
          });
          return new Response("Bad Request", {
            status: 400,
            headers: corsHeaders,
          });
        }

        // SeaTalk URL Verification
        if (body.event && body.event.seatalk_challenge) {
          await logEvent(env, "info", "Handling SeaTalk challenge", {
            challenge: body.event.seatalk_challenge,
          });
          return new Response(
            JSON.stringify({ seatalk_challenge: body.event.seatalk_challenge }),
            {
              headers: { "Content-Type": "application/json", ...corsHeaders },
            },
          );
        }

        const eventType = body.event_type;
        const event = body.event || {};

        try {
          if (eventType === "message_from_bot_subscriber") {
            // Prevent Bot Loop / Self-reply: Ignore bot messages
            const isBotSender = 
              event.sender_type === "bot" || 
              event.message?.sender_type === "bot" ||
              event.message?.is_bot === true ||
              event.sender_employee_info?.is_bot === true ||
              (event.message?.sender_id && event.message?.sender_id === env.SEATALK_APP_ID);

            if (isBotSender) {
              await logEvent(env, "info", "Ignored own bot subscriber message to prevent infinite loops", {
                sender_type: event.sender_type,
                sender_id: event.message?.sender_id
              });
              return new Response(JSON.stringify({ success: true, message: "Ignored own bot message" }), {
                headers: { "Content-Type": "application/json", ...corsHeaders }
              });
            }

            if (!event.employee_code) {
              await logEvent(env, "info", "Ignored message because employee_code is missing", { event });
              return new Response(JSON.stringify({ success: true, message: "Ignored message due to missing employee_code" }), {
                headers: { "Content-Type": "application/json", ...corsHeaders }
              });
            }

            await logEvent(env, "info", "Processing bot subscriber message", {
              event,
            });
            const tag = event.message?.tag || "text";
            let content = "";
            if (tag === "text" || tag === "markdown") {
               content = event.message?.text?.plain_text || event.message?.text?.content || event.message?.markdown?.content || "";
            } else if (tag === "image") content = "[Image]";
            else if (tag === "file") content = `[File: ${event.message?.file?.filename || "Unknown"}]`;
            else if (tag === "video") content = "[Video]";
            else if (tag === "interactive_message") content = "[Interactive Message]";
            else content = "[Unsupported Message]";
            if (content) {
              let senderName =
                event.sender_employee_info?.en_name ||
                event.sender_employee_info?.name;
              let senderEmail =
                event.sender_employee_info?.email || event.email || "";
              if (!senderName || !senderEmail) {
                const profile = await getEmployeeProfile(
                  env,
                  event.employee_code,
                );
                if (!senderName) senderName = profile.name;
                if (!senderEmail) senderEmail = profile.email;
              }
              const convId = await ensureConversation(env, {
                chat_type: "private",
                employee_code: event.employee_code,
                user_name: senderName,
                user_email: senderEmail,
              });
              
              const tag = event.message?.tag || "text";
              
              await saveMessage(env, convId, {
                sender: "user",
                sender_name: senderName,
                content,
                employee_code: event.employee_code,
                message_id: event.message_id,
                thread_id: event.message?.thread_id || "",
                quoted_message_id: event.message?.quoted_message_id || "",
                tag,
                raw_message: JSON.stringify(event.message || {})
              });

              const reply = await findMatchingRule(env, content, senderEmail, event.employee_code, "private");
              if (reply) {
                await logEvent(env, "info", "Sending auto-reply", {
                  employeeCode: event.employee_code,
                  reply,
                });
                const targetThreadId = event.message?.thread_id || event.message_id;
                const { text: replyText, messageObj } = parseReplyMessage(reply);
                await sendPrivateMessage(env, event.employee_code, replyText, messageObj, targetThreadId);
                const tag = messageObj?.tag || "text";
                await saveMessage(env, convId, {
                  sender: "bot",
                  sender_name: "Bot",
                  content: replyText,
                  employee_code: event.employee_code,
                  is_auto_reply: true,
                  thread_id: targetThreadId,
                  tag,
                  raw_message: messageObj ? JSON.stringify(messageObj) : ""
                });
              } else {
                await logEvent(env, "info", "No matching rule found", {
                  content,
                });
                
                const aiResponseText = await callCloudflareAI(env, content);
                if (aiResponseText) {
                  const targetThreadId = event.message?.thread_id || event.message_id;
                  await sendPrivateMessage(env, event.employee_code, aiResponseText, undefined, targetThreadId);
                  await saveMessage(env, convId, {
                    sender: "bot",
                    sender_name: "AI Assistant",
                    content: aiResponseText,
                    employee_code: event.employee_code,
                    is_auto_reply: true,
                    thread_id: targetThreadId,
                    tag: "text"
                  });
                }
              }
            }
          } else if (
            eventType === "new_mentioned_message_received_from_group_chat"
          ) {
            // Prevent Bot Loop / Self-reply: Ignore bot messages
            const isBotSender = 
              event.sender_type === "bot" || 
              event.message?.sender_type === "bot" ||
              event.message?.is_bot === true ||
              event.sender_employee_info?.is_bot === true ||
              (event.message?.sender_id && event.message?.sender_id === env.SEATALK_APP_ID);

            if (isBotSender) {
              await logEvent(env, "info", "Ignored own group bot message to prevent infinite loops", {
                sender_type: event.sender_type,
                sender_id: event.message?.sender_id
              });
              return new Response(JSON.stringify({ success: true, message: "Ignored own bot message" }), {
                headers: { "Content-Type": "application/json", ...corsHeaders }
              });
            }

            await logEvent(env, "info", "Processing mentioned group message", {
              event,
            });
            const tag = event.message?.tag || "text";
            let content = "";
            if (tag === "text" || tag === "markdown") {
               content = event.message?.text?.plain_text || event.message?.text?.content || event.message?.markdown?.content || "";
            } else if (tag === "image") content = "[Image]";
            else if (tag === "file") content = `[File: ${event.message?.file?.filename || "Unknown"}]`;
            else if (tag === "video") content = "[Video]";
            else if (tag === "interactive_message") content = "[Interactive Message]";
            else content = "[Unsupported Message]";
            if (content) {
              let senderName =
                event.sender_employee_info?.en_name ||
                event.sender_employee_info?.name;
              let senderEmail = event.sender_employee_info?.email || "";
              if (!senderName || !senderEmail) {
                const profile = await getEmployeeProfile(
                  env,
                  event.employee_code,
                );
                if (!senderName) senderName = profile.name;
                if (!senderEmail) senderEmail = profile.email;
              }
              const convId = await ensureConversation(env, {
                chat_type: "group",
                group_id: event.group_id,
                group_name: event.group_name || event.group_id,
              });
              
              const tag = event.message?.tag || "text";
              
              await saveMessage(env, convId, {
                sender: "user",
                sender_name: senderName,
                content,
                employee_code: event.employee_code,
                group_id: event.group_id,
                message_id: event.message_id,
                thread_id: event.message?.thread_id || "",
                quoted_message_id: event.message?.quoted_message_id || "",
                tag,
                raw_message: JSON.stringify(event.message || {})
              });

              const reply = await findMatchingRule(env, content, senderEmail, event.employee_code, "group");
              if (reply) {
                await logEvent(env, "info", "Sending group auto-reply", {
                  groupId: event.group_id,
                  reply,
                });
                const targetThreadId = event.message?.thread_id || event.message_id;
                const { text: replyText, messageObj } = parseReplyMessage(reply);
                await sendGroupMessage(
                  env,
                  event.group_id,
                  replyText,
                  targetThreadId,
                  messageObj
                );
                const tag = messageObj?.tag || "text";
                await saveMessage(env, convId, {
                  sender: "bot",
                  sender_name: "Bot",
                  content: replyText,
                  group_id: event.group_id,
                  thread_id: targetThreadId,
                  is_auto_reply: true,
                  tag,
                  raw_message: messageObj ? JSON.stringify(messageObj) : ""
                });
              } else {
                await logEvent(env, "info", "No matching group rule found", {
                  content,
                });
                
                const aiResponseText = await callCloudflareAI(env, content);
                if (aiResponseText) {
                  const targetThreadId = event.message?.thread_id || event.message_id;
                  await sendGroupMessage(env, event.group_id, aiResponseText, targetThreadId, undefined);
                  await saveMessage(env, convId, {
                    sender: "bot",
                    sender_name: "AI Assistant",
                    content: aiResponseText,
                    group_id: event.group_id,
                    thread_id: targetThreadId,
                    is_auto_reply: true,
                    tag: "text"
                  });
                }
              }
            }
          } else if (eventType === "bot_added_to_group_chat") {
            await logEvent(env, "info", "Bot added to group chat", { event });
            const reply = await findEventRule(env, "bot_added_to_group_chat");
            const groupId = event.group?.group_id;
            const groupName = event.group?.group_name || groupId;
            if (groupId) {
              const convId = await ensureConversation(env, {
                chat_type: "group",
                group_id: groupId,
                group_name: groupName,
              });
              if (reply) {
                try {
                  const { text: replyText, messageObj } = parseReplyMessage(reply);
                  await sendGroupMessage(env, groupId, replyText, undefined, messageObj);
                  const tag = messageObj?.tag || "text";
                  await saveMessage(env, convId, {
                    sender: "bot",
                    sender_name: "Bot",
                    content: replyText,
                    group_id: groupId,
                    is_auto_reply: true,
                    tag,
                    raw_message: messageObj ? JSON.stringify(messageObj) : ""
                  });
                } catch (sendErr) {
                  await logEvent(env, "error", "Failed to send greeting upon being added", {
                    groupId,
                    error: sendErr.toString()
                  });
                }
              } else {
                await logEvent(env, "info", "No bot_added rule found");
              }
            }
          } else if (eventType === "bot_removed_from_group_chat") {
            await logEvent(env, "info", "Bot removed from group chat", {
              event,
            });
            const reply = await findEventRule(
              env,
              "bot_removed_from_group_chat",
            );
            // No point updating local conversation explicitly unless we want to mark it inactive
            if (reply) {
              // Wait, can we send a message if we are removed? No! We probably can't send a message if removed.
              // We just log it. Or maybe send private message to adder? The event structure may not have enough details
            }
          } else if (eventType === "interactive_message_click") {
            const callbackValue = event.value || "";
            const messageId = event.message_id;
            const groupId = event.group_id;
            const employeeCode = event.employee_code;
            const seatalkId = event.seatalk_id;

            await logEvent(env, "info", `Interactive button clicked: ${callbackValue}`, {
              messageId,
              employeeCode,
              groupId
            });

            // 0. Duplicate check
            const actionDocId = `${messageId}_${employeeCode}`;
            try {
              const existingAction = await firestoreRequest(env, "GET", `/message_actions/${actionDocId}`);
              if (existingAction && existingAction.name) {
                 const reply = "⚠️ You have already responded to this message.";
                 const targetThreadId = messageId; // we can refine target thread if needed
                 if (groupId) {
                    await sendGroupMessage(env, groupId, reply, targetThreadId);
                 } else {
                    await sendPrivateMessage(env, employeeCode, reply, undefined, targetThreadId);
                 }
                 return new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
              }
            } catch (e) {
              // Usually 404 if not found, which is what we want
            }

            // Save the action to prevent future clicks
            try {
              await firestoreRequest(env, "POST", `/message_actions?documentId=${actionDocId}`, {
                fields: {
                  message_id: { stringValue: messageId },
                  employee_code: { stringValue: employeeCode },
                  callback_value: { stringValue: callbackValue },
                  timestamp: { stringValue: new Date().toISOString() }
                }
              });
            } catch (e) {}

            // 1. Get Google Sheets settings
            let spreadsheetId = "";
            let accessToken = "";
            let appScriptUrl = "";
            try {
              const settings = await firestoreRequest(env, "GET", "/settings/google_sheets");
              if (settings && settings.fields) {
                spreadsheetId = settings.fields.spreadsheet_id?.stringValue || "";
                accessToken = settings.fields.access_token?.stringValue || "";
                appScriptUrl = settings.fields.app_script_url?.stringValue || "";
              }
            } catch (e) {
              console.error("Failed to fetch sheets settings", e);
            }

            // 2. Fetch employee profile for logging (name/email)
            const profile = await getEmployeeProfile(env, employeeCode);

            // 3. Handle specific action: at_present (Attendance)
            let sheetAppendResult = null;
            let attendeeListMessage = "";
            let reactionMsg = "";
            
            const now = new Date();
            const timestamp = now.toLocaleString("en-US", { timeZone: "Asia/Manila" });
            const dateStr = now.toLocaleDateString("en-US", { timeZone: "Asia/Manila" });
            const timeStr = now.toLocaleTimeString("en-US", { timeZone: "Asia/Manila" });
            
            // Log structure: [Email, Nickname, Date, Time, EmployeeCode, SeaTalkID]
            const displayName = profile.nickname || profile.name;
            const rowData = [profile.email, displayName, dateStr, timeStr, employeeCode, seatalkId];

            if (callbackValue === "at_present") {
              // --- Option A: Google Apps Script (Recommended) ---
              if (appScriptUrl) {
                try {
                  const scriptRes = await fetch(appScriptUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "append",
                      data: rowData,
                      dateKey: dateStr
                    })
                  });
                  const scriptData = await scriptRes.json();
                  sheetAppendResult = scriptData;
                  await logEvent(env, "info", "Apps Script log result", scriptData);
                  
                  if (scriptData.attendees && Array.isArray(scriptData.attendees)) {
                    const uniqueAttendees = [...new Set(scriptData.attendees)];
                    attendeeListMessage = `📊 **Attendance List (${dateStr})**\n` + 
                                         uniqueAttendees.map((name, i) => `${i + 1}. ${name}`).join("\n");
                  }

                  if (scriptData.status === "duplicate") {
                    reactionMsg = `⚠️ You have already marked your attendance today, ${displayName}.`;
                  } else {
                    reactionMsg = `✅ **Attendance Captured:** Your presence has been recorded, ${displayName}.`;
                  }
                } catch (scriptErr) {
                  console.error("Apps Script failed", scriptErr);
                  await logEvent(env, "error", "Apps Script operation failed", { error: scriptErr.toString() });
                }
              } 
                // --- Option B: Direct Sheets API (Token Based) ---
              else if (spreadsheetId && accessToken) {
                try {
                  // Fetch updated list first to check for duplicates
                  const allRows = await getSheetValues(env, spreadsheetId, accessToken);
                  const todaysAttendees = allRows
                    .filter(row => row[2] && row[2].includes(dateStr))
                    .map(row => row[1]); // Column B: Nickname
                  
                  const isDuplicate = todaysAttendees.includes(displayName);
                  if (!isDuplicate) {
                    const sheetsRes = await fetch(
                      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`,
                      {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${accessToken}`,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          values: [rowData],
                        }),
                      }
                    );
                    sheetAppendResult = await sheetsRes.json();
                    await logEvent(env, "info", "Google Sheets log result", sheetAppendResult);
                    todaysAttendees.push(displayName);
                  }

                  const uniqueAttendees = [...new Set(todaysAttendees)];
                  attendeeListMessage = `📊 **Current Attendance (${dateStr})**\n` + 
                                       uniqueAttendees.map((name, i) => `${i + 1}. ${name}`).join("\n");
                  
                  if (isDuplicate) {
                    reactionMsg = `⚠️ You have already marked your attendance today, ${displayName}.`;
                  } else {
                    reactionMsg = `✅ **Attendance Captured:** Your presence has been recorded, ${displayName}.`;
                  }
                } catch (sheetErr) {
                  console.error("Failed to append to sheet", sheetErr);
                  await logEvent(env, "error", "Google Sheets operation failed", { error: sheetErr.toString() });
                }
              }
            }

            // 4. Determine response message
            // Try to find original message to get sim_response and thread_id
            const originalDoc = await getMessageByMessageId(env, messageId);
            let simResponse = null;
            let targetThreadId = messageId;

            if (originalDoc && originalDoc.fields) {
              if (originalDoc.fields.thread_id && originalDoc.fields.thread_id.stringValue) {
                targetThreadId = originalDoc.fields.thread_id.stringValue;
              }
              if (originalDoc.fields.raw_message) {
                try {
                  const raw = JSON.parse(originalDoc.fields.raw_message.stringValue);
                  
                  // Get elements from all possible sections (default/elements/zh-Hans)
                  const allElements = [
                    ...(raw.interactive_message?.elements || []),
                    ...(raw.interactive_message?.default?.elements || []),
                    ...(raw.interactive_message?.["zh-Hans"]?.elements || [])
                  ];

                  // Search for the button with the matching value
                  for (const el of allElements) {
                    if (el.element_type === "button" && el.button?.value === callbackValue) {
                      simResponse = el.button.sim_response;
                      if (simResponse) break;
                    }
                    if (el.element_type === "button_group" && el.button_group) {
                      for (const btn of el.button_group) {
                        if (btn.value === callbackValue) {
                          simResponse = btn.sim_response;
                          if (simResponse) break;
                        }
                      }
                      if (simResponse) break;
                    }
                  }
                } catch (e) {
                  console.error("Failed to parse raw_message for sim_response", e);
                }
              }
            }

            if (!reactionMsg) {
              reactionMsg = simResponse;
              if (reactionMsg) {
                await logEvent(env, "info", `Using simulated response for ${callbackValue}`, { reactionMsg });
              } else {
                // Fallback logic
                if (callbackValue === "at_present") {
                   reactionMsg = sheetAppendResult?.error 
                    ? "❌ **Error:** Failed to record attendance to Google Sheets. Please ensure the token is valid in Settings."
                    : "✅ **Attendance Captured:** Your presence has been recorded in the Google Tracking Sheet.";
                } else if (callbackValue === "approve") {
                  reactionMsg = "✅ **Action Approved** by the operator.";
                } else if (callbackValue === "reject") {
                  reactionMsg = "❌ **Action Rejected** by the operator.";
                } else {
                  reactionMsg = `⚙️ **Webhook OK (200):** Custom payload value \`${callbackValue}\` processed successfully.`;
                }
                await logEvent(env, "info", `Using fallback response for ${callbackValue}`, { reactionMsg });
              }
            } else {
              await logEvent(env, "info", `Using predefined block response for ${callbackValue}`, { reactionMsg });
            }

            if (attendeeListMessage) {
              reactionMsg = reactionMsg + "\n\n" + attendeeListMessage;
            }

            // Send response back to chat
            try {
              if (groupId) {
                await sendGroupMessage(env, groupId, reactionMsg, targetThreadId);
              } else if (employeeCode) {
                await sendPrivateMessage(env, employeeCode, reactionMsg, undefined, targetThreadId);
              }
              await logEvent(env, "info", `Response sent to SeaTalk for ${callbackValue}`, { success: true });
            } catch (sendErr) {
              await logEvent(env, "error", `Failed sending simulation response to SeaTalk`, { error: sendErr.toString() });
            }

            // Save the response message to Firestore
            const convId = groupId || employeeCode;
            if (convId) {
              await saveMessage(env, convId, {
                sender: "bot",
                sender_name: "Bot",
                content: reactionMsg,
                employee_code: employeeCode,
                group_id: groupId,
                thread_id: targetThreadId,
                quoted_message_id: targetThreadId,
                is_auto_reply: true,
              });
            }
          }
        } catch (err) {
          console.error("Event handler error:", err);
          await logEvent(env, "error", "Error in event handler", {
            error: err.toString(),
            stack: err.stack,
          });
        }

        return new Response(JSON.stringify({ code: 0 }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      await logEvent(env, "warning", "Route not found", {
        method: request.method,
        url: url.pathname,
      });
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (e) {
      console.error("Global Catch Event:", e);
      return new Response(
        JSON.stringify({ error: e.message, status: "Failed" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        },
      );
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledBroadcasts(env));
  },
};
