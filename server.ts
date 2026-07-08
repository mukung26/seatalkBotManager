import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import fs from 'fs';
import crypto from 'crypto';

const app = express();
const PORT = 3000;

// Initialize SQLite database
const dbPath = path.join(process.cwd(), 'database.sqlite');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_type TEXT,
    employee_code TEXT,
    group_id TEXT,
    group_name TEXT,
    user_name TEXT,
    user_email TEXT,
    last_message TEXT,
    last_message_time TEXT,
    unread_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER,
    message_id TEXT,
    sender TEXT,
    sender_name TEXT,
    content TEXT,
    message_type TEXT,
    employee_code TEXT,
    group_id TEXT,
    is_auto_reply INTEGER DEFAULT 0,
    sent_at TEXT,
    tag TEXT DEFAULT 'text',
    thread_id TEXT DEFAULT '',
    quoted_message_id TEXT DEFAULT '',
    raw_message TEXT DEFAULT '',
    FOREIGN KEY(conversation_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    trigger_type TEXT,
    keywords TEXT,
    match_type TEXT,
    reply_message TEXT,
    is_active INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT,
    level TEXT,
    message TEXT,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS broadcasts (
    id TEXT PRIMARY KEY,
    title TEXT,
    content TEXT,
    target_type TEXT,
    target_value TEXT,
    status TEXT,
    scheduled_at TEXT,
    created_at TEXT,
    sent_at TEXT,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS message_actions (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    action_id TEXT,
    callback_data TEXT,
    clicked_by_user_id TEXT,
    clicked_by_user_name TEXT,
    clicked_at TEXT
  );
`);

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

const SEATALK_API = 'https://openapi.seatalk.io';
const SEATALK_APP_ID = process.env.SEATALK_APP_ID || '';
const SEATALK_APP_SECRET = process.env.SEATALK_APP_SECRET || '';

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  try {
    const res = await fetch(`${SEATALK_API}/auth/v1/app_access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: SEATALK_APP_ID, app_secret: SEATALK_APP_SECRET }),
    });
    const data = await res.json() as any;
    if (data.code !== 0) throw new Error(`Token error: ${data.message}`);
    cachedToken = data.app_access_token;
    tokenExpiry = Date.now() + (data.expire - 60) * 1000;
    return cachedToken;
  } catch (error) {
    console.error("Failed to get Seatalk token:", error);
    return null;
  }
}

function processMessageMentions(messageObj: any) {
  if (!messageObj) return messageObj;
  const messageData = JSON.parse(JSON.stringify(messageObj));

  if (messageData.tag === "text" && messageData.text) {
    let content = messageData.text.content || "";
    const emails = messageData.text.mentioned_email_list || [];
    let atAll = messageData.text.at_all || false;

    const mentionRegex = /<mention\s+email=["']([^"']+)["']>\s*<\/mention>/gi;
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      if (!emails.includes(match[1])) {
        emails.push(match[1]);
      }
    }

    content = content.replace(mentionRegex, (m, email) => {
      const name = email.split("@")[0];
      return `@${name}`;
    });

    const atAllRegex = /<mention>\s*<\/mention>/gi;
    if (atAllRegex.test(content)) {
      atAll = true;
      content = content.replace(atAllRegex, "@all");
    }

    messageData.text.content = content;
    if (emails.length > 0) {
      messageData.text.mentioned_email_list = emails;
    }
    if (atAll) {
      messageData.text.at_all = true;
    }
  } else if (messageData.tag === "markdown" && messageData.markdown) {
    let content = messageData.markdown.content || "";
    const emails = messageData.markdown.mentioned_email_list || [];
    let atAll = messageData.markdown.at_all || false;

    const mentionRegex = /<mention\s+email=["']([^"']+)["']>\s*<\/mention>/gi;
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      if (!emails.includes(match[1])) {
        emails.push(match[1]);
      }
    }

    content = content.replace(mentionRegex, (m, email) => {
      const name = email.split("@")[0];
      return `@${name}`;
    });

    const atAllRegex = /<mention>\s*<\/mention>/gi;
    if (atAllRegex.test(content)) {
      atAll = true;
      content = content.replace(atAllRegex, "@all");
    }

    messageData.markdown.content = content;
    if (emails.length > 0) {
      messageData.markdown.mentioned_email_list = emails;
    }
    if (atAll) {
      messageData.markdown.at_all = true;
    }
  }
  return messageData;
}

async function sendPrivateMessage(employeeCode: string, text: string, messageObj?: any) {
  const token = await getAccessToken();
  if (!token) return;
  const messageData = messageObj ? messageObj : processMessageMentions({ tag: 'text', text: { content: text } });
  await fetch(`${SEATALK_API}/messaging/v2/single_chat`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_code: employeeCode, message: messageData }),
  });
}

async function sendGroupMessage(groupId: string, text: string, threadId?: string, messageObj?: any) {
  const token = await getAccessToken();
  if (!token) return;
  const messageData = messageObj ? messageObj : processMessageMentions({ tag: 'text', text: { content: text } });
  const body: any = { group_id: groupId, message: messageData };
  if (threadId) body.thread_id = threadId;
  await fetch(`${SEATALK_API}/messaging/v2/group_chat`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}


function ensureConversation(info: any) {
  let query = '';
  let params: any[] = [];
  if (info.chat_type === 'group') {
    query = 'SELECT * FROM conversations WHERE group_id = ? AND chat_type = "group"';
    params = [info.group_id];
  } else {
    query = 'SELECT * FROM conversations WHERE employee_code = ? AND chat_type = "private"';
    params = [info.employee_code];
  }
  
  const existing = db.prepare(query).get(...params);
  if (existing) return existing;
  
  const insert = db.prepare(`
    INSERT INTO conversations (chat_type, employee_code, group_id, group_name, user_name, user_email, last_message_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(info.chat_type, info.employee_code || null, info.group_id || null, info.group_name || null, info.user_name || null, info.user_email || null, new Date().toISOString());
  
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(insert.lastInsertRowid);
}

function saveMessage(convId: number, info: any) {
  db.prepare(`
    INSERT INTO messages (conversation_id, message_id, sender, sender_name, content, message_type, employee_code, group_id, is_auto_reply, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(convId, info.message_id || '', info.sender, info.sender_name, info.content, 'text', info.employee_code || null, info.group_id || null, info.is_auto_reply ? 1 : 0, new Date().toISOString());
  
  db.prepare(`UPDATE conversations SET last_message = ?, last_message_time = ?, unread_count = unread_count + ? WHERE id = ?`)
    .run(info.content.substring(0, 80), new Date().toISOString(), info.is_auto_reply ? 0 : 1, convId);
}


function parseReplyMessage(reply: string) {
  if (!reply) return { text: "", messageObj: undefined };
  let messageObj = undefined;
  let text = reply;
  try {
    const trimmed = reply.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.tag) {
        messageObj = parsed;
        if (parsed.tag === "interactive_message") {
          text = "[Interactive Message]";
        } else if (parsed.tag === "image") {
          text = "[Image]";
        } else if (parsed.tag === "file") {
          text = `[File: ${parsed.file?.filename || "Uploaded file"}]`;
        } else if (parsed.tag === "markdown") {
          text = parsed.markdown?.content || "[Markdown]";
        } else if (parsed.tag === "text") {
          text = parsed.text?.content || reply;
        } else {
          text = `[${parsed.tag.toUpperCase()} Message]`;
        }
      } else if (parsed && parsed.interactive_message) {
        messageObj = { tag: "interactive_message", ...parsed };
        text = "[Interactive Message]";
      }
    }
  } catch (e) {}
  return { text, messageObj };
}

function getAutoReply(text: string) {
  const rules = db.prepare('SELECT * FROM rules WHERE is_active = 1 ORDER BY priority DESC').all() as any[];
  const lowerMsg = text.toLowerCase();
  
  for (const rule of rules) {
    if (rule.trigger_type === 'fallback' || rule.trigger_type === 'greeting') continue;
    if (rule.trigger_type === 'keyword' && rule.keywords) {
      const kws = JSON.parse(rule.keywords);
      const matched = kws.some((kw: string) => {
        const lKw = kw.toLowerCase();
        if (rule.match_type === 'exact') return lowerMsg === lKw;
        if (rule.match_type === 'starts_with') return lowerMsg.startsWith(lKw);
        return lowerMsg.includes(lKw);
      });
      if (matched) return rule.reply_message;
    }
  }
  const fallback = rules.find((r: any) => r.trigger_type === 'fallback');
  if (fallback) return fallback.reply_message;
  return null;
}

app.post('/api/seatalk/webhook', async (req, res) => {
  console.log('Webhook payload:', req.body);
  const body = req.body;
  if (!body) return res.send("OK");
  
  if (body.event && body.event.seatalk_challenge) {
     console.log('Responding to challenge:', body.event.seatalk_challenge);
     return res.json({ seatalk_challenge: body.event.seatalk_challenge });
  }
  
  const eventType = body.event_type;
  const event = body.event || {};
  
  try {
    if (eventType === 'message_from_bot_subscriber') {
       const content = event.message?.text?.content;
       if (content) {
         const conv = ensureConversation({ chat_type: 'private', employee_code: event.employee_code, user_name: event.sender_employee_info?.en_name || event.employee_code, user_email: event.sender_employee_info?.email || '' });
         saveMessage((conv as any).id, { sender: 'user', sender_name: event.sender_employee_info?.en_name || event.employee_code, content, employee_code: event.employee_code, message_id: event.message_id });
         
         const rep = getAutoReply(content);
         if (rep) {
           const { text: replyText, messageObj } = parseReplyMessage(rep);
           await sendPrivateMessage(event.employee_code, replyText, messageObj);
           saveMessage((conv as any).id, { sender: 'bot', sender_name: 'Bot', content: replyText, employee_code: event.employee_code, is_auto_reply: true });
         }
       }
    } else if (eventType === 'new_mentioned_message_received_from_group_chat') {
       const content = event.message?.text?.content;
       if (content) {
         const conv = ensureConversation({ chat_type: 'group', group_id: event.group_id, group_name: event.group_name || event.group_id });
         saveMessage((conv as any).id, { sender: 'user', sender_name: event.sender_employee_info?.en_name || event.employee_code, content, employee_code: event.employee_code, group_id: event.group_id, message_id: event.message_id });
         
         const rep = getAutoReply(content);
         if (rep) {
           const { text: replyText, messageObj } = parseReplyMessage(rep);
           await sendGroupMessage(event.group_id, replyText, event.thread_id, messageObj);
           saveMessage((conv as any).id, { sender: 'bot', sender_name: 'Bot', content: replyText, group_id: event.group_id, is_auto_reply: true });
         }
       }
    } else if (eventType === 'user_enter_chatroom_with_bot') {
       const conv = ensureConversation({ chat_type: 'private', employee_code: event.employee_code, user_name: event.employee_code });
       const greetingRule = db.prepare('SELECT * FROM rules WHERE is_active = 1 AND trigger_type = "greeting"').get() as any;
       if (greetingRule) {
           await sendPrivateMessage(event.employee_code, greetingRule.reply_message);
           saveMessage((conv as any).id, { sender: 'bot', sender_name: 'Bot', content: greetingRule.reply_message, employee_code: event.employee_code, is_auto_reply: true });
       }
    }
  } catch(e) {
    console.error('Error handling webhook', e);
  }
  
  res.json({ code: 0 });
});


// API Ext and Aligned Dashboard Routes

// 1. GET /api/dashboard/conversations
app.get('/api/dashboard/conversations', (req, res) => {
  const convs = db.prepare('SELECT * FROM conversations ORDER BY last_message_time DESC').all();
  res.json({ success: true, data: convs });
});

// Backward compatibility: GET /api/conversations
app.get('/api/conversations', (req, res) => {
  const convs = db.prepare('SELECT * FROM conversations ORDER BY last_message_time DESC').all();
  res.json(convs);
});

// 2. GET /api/dashboard/conversations/:id/messages
app.get('/api/dashboard/conversations/:id/messages', (req, res) => {
  const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC').all(req.params.id);
  db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true, data: msgs });
});

// Backward compatibility: GET /api/conversations/:id/messages
app.get('/api/conversations/:id/messages', (req, res) => {
  const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC').all(req.params.id);
  db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(req.params.id);
  res.json(msgs);
});

// 3. POST /api/dashboard/conversations/:id/mark-read
app.post('/api/dashboard/conversations/:id/mark-read', (req, res) => {
  db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 4. DELETE /api/dashboard/conversations/:id
app.delete('/api/dashboard/conversations/:id', (req, res) => {
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 5. GET /api/dashboard/rules
app.get('/api/dashboard/rules', (req, res) => {
  const results = db.prepare('SELECT * FROM rules ORDER BY priority DESC').all() as any[];
  const formatted = results.map(r => {
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
  res.json({ success: true, data: formatted });
});

// Backward compatibility: GET /api/rules
app.get('/api/rules', (req, res) => {
  const rules = db.prepare('SELECT * FROM rules ORDER BY priority DESC').all();
  res.json(rules);
});

// 6. POST /api/dashboard/rules
app.post('/api/dashboard/rules', (req, res) => {
  const { trigger_type, keywords, match_type, reply_message, is_active, priority } = req.body;
  const ruleId = "rule_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  const kwStr = Array.isArray(keywords) ? JSON.stringify(keywords) : "[]";
  const activeVal = is_active === true || is_active === 1 ? 1 : 0;
  const priorityVal = priority || 0;

  db.prepare(`
    INSERT INTO rules (id, trigger_type, keywords, match_type, reply_message, is_active, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(ruleId, trigger_type, kwStr, match_type || "contains", reply_message || "", activeVal, priorityVal);
  
  res.json({ success: true, id: ruleId });
});

// Backward compatibility: POST /api/rules
app.post('/api/rules', (req, res) => {
  const { trigger_type, keywords, match_type, reply_message, is_active, priority } = req.body;
  const ruleId = "rule_" + Date.now();
  db.prepare(`INSERT INTO rules (id, trigger_type, keywords, match_type, reply_message, is_active, priority) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(ruleId, trigger_type, keywords ? JSON.stringify(keywords) : '[]', match_type || 'contains', reply_message, is_active ? 1 : 0, priority || 0);
  res.json({ id: ruleId });
});

// 7. PUT /api/dashboard/rules/:id
app.put('/api/dashboard/rules/:id', (req, res) => {
  const { trigger_type, keywords, match_type, reply_message, is_active, priority } = req.body;
  const kwStr = Array.isArray(keywords) ? JSON.stringify(keywords) : "[]";
  const activeVal = is_active === true || is_active === 1 ? 1 : 0;
  const priorityVal = priority || 0;

  db.prepare(`
    UPDATE rules 
    SET trigger_type = ?, keywords = ?, match_type = ?, reply_message = ?, is_active = ?, priority = ?
    WHERE id = ?
  `).run(trigger_type, kwStr, match_type || "contains", reply_message || "", activeVal, priorityVal, req.params.id);

  res.json({ success: true });
});

// 8. DELETE /api/dashboard/rules/:id
app.delete('/api/dashboard/rules/:id', (req, res) => {
  db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Backward compatibility: DELETE /api/rules/:id
app.delete('/api/rules/:id', (req, res) => {
  db.prepare('DELETE FROM rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 9. GET /api/dashboard/logs
app.get('/api/dashboard/logs', (req, res) => {
  const logs = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 200').all();
  res.json({ success: true, data: logs });
});

// 10. POST /api/dashboard/logs
app.post('/api/dashboard/logs', (req, res) => {
  const { level, message, details } = req.body;
  const id = "log_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  const timestamp = new Date().toISOString();
  db.prepare('INSERT INTO logs (id, timestamp, level, message, details) VALUES (?, ?, ?, ?, ?)')
    .run(id, timestamp, level || "info", message || "", JSON.stringify(details || {}));
  res.json({ success: true });
});

// 11. DELETE /api/dashboard/logs
app.delete('/api/dashboard/logs', (req, res) => {
  db.prepare('DELETE FROM logs').run();
  res.json({ success: true });
});

// 12. GET /api/dashboard/settings
app.get('/api/dashboard/settings', (req, res) => {
  const results = db.prepare('SELECT * FROM settings').all() as any[];
  const settingsObj: any = {};
  if (results) {
    for (const r of results) {
      try {
        settingsObj[r.key] = JSON.parse(r.value);
      } catch {
        settingsObj[r.key] = r.value;
      }
    }
  }
  res.json({ success: true, data: settingsObj });
});

// 13. POST /api/dashboard/settings
app.post('/api/dashboard/settings', (req, res) => {
  const { key, value } = req.body;
  const valStr = typeof value === "object" ? JSON.stringify(value) : String(value);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, valStr);
  res.json({ success: true });
});

// 14. GET /api/dashboard/broadcasts
app.get('/api/dashboard/broadcasts', (req, res) => {
  const b = db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC').all();
  res.json({ success: true, data: b });
});

// 15. POST /api/dashboard/broadcasts
app.post('/api/dashboard/broadcasts', (req, res) => {
  const { title, content, target_type, target_value, status, scheduled_at } = req.body;
  const bId = "broad_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  const cAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO broadcasts (id, title, content, target_type, target_value, status, scheduled_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(bId, title || "", content || "", target_type || "all", target_value || "", status || "draft", scheduled_at || "", cAt);
  res.json({ success: true, id: bId });
});

// 16. PUT /api/dashboard/broadcasts/:id
app.put('/api/dashboard/broadcasts/:id', (req, res) => {
  const { title, content, target_type, target_value, status, scheduled_at } = req.body;
  db.prepare(`
    UPDATE broadcasts 
    SET title = ?, content = ?, target_type = ?, target_value = ?, status = ?, scheduled_at = ?
    WHERE id = ?
  `).run(title, content, target_type, target_value, status, scheduled_at, req.params.id);
  res.json({ success: true });
});

// 17. DELETE /api/dashboard/broadcasts/:id
app.delete('/api/dashboard/broadcasts/:id', (req, res) => {
  db.prepare('DELETE FROM broadcasts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 18. DELETE /api/dashboard/messages/:id
app.delete('/api/dashboard/messages/:id', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 18.0 PUT /api/dashboard/messages/:id
app.put('/api/dashboard/messages/:id', (req, res) => {
  const { raw_message } = req.body;
  db.prepare('UPDATE messages SET raw_message = ? WHERE id = ?').run(raw_message, req.params.id);
  res.json({ success: true });
});

// 18.1 POST /api/dashboard/ensure_conversation
app.post('/api/dashboard/ensure_conversation', (req, res) => {
  const { chat_type, employee_code, user_name, user_email, group_id, group_name } = req.body;
  const conv = ensureConversation({
    chat_type,
    employee_code: employee_code || "",
    user_name: user_name || "",
    user_email: user_email || "",
    group_id: group_id || "",
    group_name: group_name || "",
  });
  res.json({ success: true, conversation_id: (conv as any).id });
});

// 18.2 POST /api/dashboard/send
app.post('/api/dashboard/send', async (req, res) => {
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
    sender,
    sender_name,
    is_auto_reply
  } = req.body;

  let convId = conversation_id;
  if (convId && String(convId).startsWith("new_")) {
    const conv = ensureConversation({
      chat_type,
      employee_code: chat_type === "private" ? target_id : "",
      user_name: chat_type === "private" ? user_name || user_email || target_id : "",
      user_email: chat_type === "private" ? user_email : "",
      group_id: chat_type === "group" ? target_id : "",
      group_name: chat_type === "group" ? group_name || target_id : "",
    });
    convId = (conv as any).id;
  }

  try {
    if (chat_type === "private") {
      await sendPrivateMessage(target_id, content, message_obj);
    } else if (chat_type === "group") {
      await sendGroupMessage(target_id, content, thread_id, message_obj);
    }
  } catch (err) {
    console.log("Failed actual SeaTalk transmission", err);
  }

  if (convId) {
    saveMessage(Number(convId), {
      sender: sender || "admin",
      sender_name: sender_name || "Admin",
      content,
      employee_code: chat_type === "private" ? target_id : "",
      group_id: chat_type === "group" ? target_id : "",
      is_auto_reply: is_auto_reply || false,
    });
  }

  res.json({ success: true, conversation_id: convId });
});

// 19. POST /api/messages/send
app.post('/api/messages/send', async (req, res) => {
  const { conversation_id, content } = req.body;
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation_id) as any;
  if (!conv) return res.status(404).json({error: "Conversation not found"});
  
  if (conv.chat_type === 'private') {
    await sendPrivateMessage(conv.employee_code, content);
  } else {
    await sendGroupMessage(conv.group_id, content);
  }
  
  saveMessage(conv.id, { sender: 'admin', sender_name: 'Admin', content, employee_code: conv.employee_code, group_id: conv.group_id, is_auto_reply: false });
  res.json({ success: true });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
