const fs = require('fs');
let code = fs.readFileSync('cloudflare-worker.js', 'utf8');

const missingFuncs = `
async function getAccessToken(env) {
  const url = \`\${SEATALK_API}/auth/app_access_token\`;
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
  if (data.code !== 0) throw new Error(\`Failed to get access token: \${data.message}\`);
  return data.app_access_token;
}

async function firestoreRequest(env, method, path, body = null) {
  const url = \`https://firestore.googleapis.com/v1/projects/\${env.FIREBASE_PROJECT_ID}/databases/(default)/documents\${path}?key=\${env.FIREBASE_API_KEY}\`;
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(\`Firestore error: \${await res.text()}\`);
  return await res.json();
}

async function findMatchingRule(env, messageText, email, employeeCode, chatType) {
  try {
    const rulesData = await firestoreRequest(env, "GET", "/rules");
    if (!rulesData || !rulesData.documents) return null;
    const lowerMsg = messageText.toLowerCase();
    const rules = rulesData.documents.map(d => ({
      ...d.fields,
      priority: d.fields.priority?.integerValue || d.fields.priority?.stringValue || 0
    })).sort((a, b) => Number(b.priority) - Number(a.priority));

    for (const rule of rules) {
      if (rule.is_active?.booleanValue && rule.trigger_type?.stringValue === "keyword") {
        let keywords = [];
        try { keywords = JSON.parse(rule.keywords?.stringValue || "[]"); } catch(e) {}
        const matchType = rule.match_type?.stringValue || "exact";
        let match = false;
        if (matchType === "exact") {
          match = keywords.some(k => k.toLowerCase() === lowerMsg);
        } else {
          match = keywords.some(k => lowerMsg.includes(k.toLowerCase()));
        }
        if (match) return rule.reply_message?.stringValue || null;
      }
    }
  } catch (err) {}
  return null;
}

async function findEventRule(env, eventType) {
  try {
    const rulesData = await firestoreRequest(env, "GET", "/rules");
    if (!rulesData || !rulesData.documents) return null;
    for (const doc of rulesData.documents) {
      const rule = doc.fields;
      if (rule.is_active?.booleanValue && rule.trigger_type?.stringValue === eventType) {
        return rule.reply_message?.stringValue || null;
      }
    }
  } catch(e) {}
  return null;
}

async function getEmployeeProfile(env, employeeCode) {
  const result = { name: employeeCode, email: "" };
  try {
    const token = await getAccessToken(env);
    const res = await fetch(\`\${SEATALK_API}/contacts/v2/profile?employee_code=\${employeeCode}\`, {
      headers: { Authorization: \`Bearer \${token}\` }
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
  const messageData = messageObj ? JSON.parse(JSON.stringify(messageObj)) : { tag: "text", text: { content: text } };
  if (threadId) {
    messageData.thread_id = threadId;
    messageData.quoted_message_id = threadId; 
  }
  const res = await fetch(\`\${SEATALK_API}/messaging/v2/single_chat\`, {
    method: "POST",
    headers: { Authorization: \`Bearer \${token}\`, "Content-Type": "application/json" },
    body: JSON.stringify({ employee_code: employeeCode, message: messageData }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(\`SeaTalk API Error: \${JSON.stringify(data)}\`);
}

async function sendGroupMessage(env, groupId, text, threadId, messageObj) {
  const token = await getAccessToken(env);
  const messageData = messageObj ? JSON.parse(JSON.stringify(messageObj)) : { tag: "text", text: { content: text } };
  if (threadId) {
    messageData.thread_id = threadId;
    messageData.quoted_message_id = threadId; 
  }
  const body = { group_id: groupId, message: messageData };
  const res = await fetch(\`\${SEATALK_API}/messaging/v2/group_chat\`, {
    method: "POST",
    headers: { Authorization: \`Bearer \${token}\`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(\`SeaTalk API Error: \${JSON.stringify(data)}\`);
}

async function ensureConversation(env, info) {
  const convId = info.chat_type === "group" ? info.group_id : info.employee_code;
  try {
    const docPath = \`/conversations/\${convId}\`;
    try {
      await firestoreRequest(env, "GET", docPath);
    } catch(e) {
      const doc = {
        fields: {
          chat_type: { stringValue: info.chat_type },
          employee_code: { stringValue: info.employee_code || "" },
          group_id: { stringValue: info.group_id || "" },
          group_name: { stringValue: info.group_name || "" },
          user_name: { stringValue: info.user_name || "" },
          user_email: { stringValue: info.user_email || "" },
          last_message_time: { stringValue: new Date().toISOString() },
        }
      };
      await firestoreRequest(env, "PATCH", \`\${docPath}?updateMask.fieldPaths=chat_type&updateMask.fieldPaths=employee_code&updateMask.fieldPaths=group_id&updateMask.fieldPaths=group_name&updateMask.fieldPaths=user_name&updateMask.fieldPaths=user_email&updateMask.fieldPaths=last_message_time\`, doc);
    }
  } catch(e) {}
  return convId;
}

async function saveMessage(env, convId, info) {
  try {
    const doc = {
      fields: {
        conversation_id: { stringValue: String(convId) },
        message_id: { stringValue: info.message_id || Date.now().toString() },
        sender: { stringValue: info.sender },
        sender_name: { stringValue: info.sender_name || "" },
        content: { stringValue: info.content || "" },
        tag: { stringValue: info.tag || "text" },
        employee_code: { stringValue: info.employee_code || "" },
        group_id: { stringValue: info.group_id || "" },
        thread_id: { stringValue: info.thread_id || "" },
        is_auto_reply: { booleanValue: !!info.is_auto_reply },
        sent_at: { stringValue: new Date().toISOString() }
      }
    };
    await firestoreRequest(env, "POST", "/messages", doc);
  } catch(e) {}
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
        else if (parsed.tag === "file") text = \`[File]\`;
        else if (parsed.tag === "text") text = parsed.text?.content || reply;
      }
    }
  } catch(e) {}
  return { text, messageObj };
}

async function runScheduledBroadcasts(env) {
  try {
    // Basic placeholder for now, since it wasn't requested directly but might be missing
    console.log("Running broadcasts");
  } catch(e) {}
}
`;

const targetStart = 'async function callCloudflareAI(env, messageText) {';
const startIndex = code.indexOf(targetStart);
if (startIndex !== -1) {
  code = code.substring(0, startIndex) + missingFuncs + "\n" + code.substring(startIndex);
  fs.writeFileSync('cloudflare-worker.js', code);
  console.log("Restored missing functions");
} else {
  console.log("Could not find callCloudflareAI");
}
