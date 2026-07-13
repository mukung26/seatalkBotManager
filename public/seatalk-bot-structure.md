# SeaTalk Bot - Full Code Dump

## Environment Variables & Configuration

```json
{
  "SEATALK_APP_ID": "ODM3MjMzMzQ4NjIy",
  "SEATALK_APP_SECRET": "zYGIy5TieIrsVO2NJaT4jLcaD5tFwh6R",
  "SEATALK_EVENT_SECRET": "udxHbEMxm7vHki70iSVnbIK2x1zamBOn",
  "FIREBASE_PROJECT_ID": "fir-web-codelab-44e26",
  "FIREBASE_API_KEY": "AIzaSyB6QXqIOoM8NceP_Ya2xVK60pCoJGZzB9c"
}
```

## `cloudflare-worker.js`

```js
/**
 * SeaTalk Bot Webhook - Cloudflare Worker with Firebase Firestore
 * ===============================================================
 * Deploy this to your Cloudflare Worker.
 * Make sure to add these environment variables in the Cloudflare Dashboard:
 * - SEATALK_APP_ID
 * - SEATALK_APP_SECRET
 * - SEATALK_EVENT_SECRET
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_API_KEY
 */

const SEATALK_API = "https://openapi.seatalk.io";

// --- Logging Helper ---
async function logEvent(env, level, message, details = {}) {
  try {
    const timestamp = new Date().toISOString();
    const res = await firestoreRequest(env, "POST", `/logs`, {
      fields: {
        timestamp: { stringValue: timestamp },
        level: { stringValue: level },
        message: { stringValue: message },
        details: { stringValue: JSON.stringify(details) },
      },
    });
    if (res && res.error) {
      console.error("Firebase rejected log:", res.error);
      return { success: false, error: res.error };
    }
    return { success: true, res };
  } catch (e) {
    console.error("Failed to log", e);
    return { success: false, error: e.message };
  }
}

// --- Authentication for SeaTalk ---
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${SEATALK_API}/auth/app_access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: env.SEATALK_APP_ID,
      app_secret: env.SEATALK_APP_SECRET,
    }),
  });

  const textBody = await res.text();
  let data;
  try {
    data = JSON.parse(textBody);
  } catch (e) {
    throw new Error(`Token parse error. Body: ${textBody}`);
  }
  if (data.code !== 0) throw new Error(`Token error: ${data.message}`);

  cachedToken = data.app_access_token;
  tokenExpiry = Date.now() + (data.expire - 60) * 1000;
  return cachedToken;
}

// --- Firebase Firestore REST Helpers ---
async function firestoreRequest(env, method, path, body = null) {
  const projectId = (env.FIREBASE_PROJECT_ID || "").trim();
  const apiKey = (env.FIREBASE_API_KEY || "").trim();
  const connector = path.includes("?") ? "&" : "?";
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents${path}${connector}key=${apiKey}`;

  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const textBody = await res.text();
  if (!textBody) return null;
  try {
    return JSON.parse(textBody);
  } catch (e) {
    throw new Error(
      `Firestore text parse error: ${e.message} for body: ${textBody}`,
    );
  }
}

/**
 * Ensures a conversation exists in Firestore. If it does not, creates it.
 */
async function ensureConversation(env, info) {
  const collectionId =
    info.chat_type === "group" ? info.group_id : info.employee_code;
  const docPath = `/conversations/${collectionId}`;

  // Try to get existing
  const existing = await firestoreRequest(env, "GET", docPath);

  if (existing && !existing.error) {
    const updates = {};
    const masks = [];
    const currentUserName = existing.fields.user_name?.stringValue || "";
    const currentUserEmail = existing.fields.user_email?.stringValue || "";
    const currentGroupName = existing.fields.group_name?.stringValue || "";

    if (
      info.user_name &&
      (!currentUserName ||
        currentUserName === info.employee_code ||
        (info.user_name !== currentUserName &&
          !info.user_name.startsWith("e_")))
    ) {
      updates.user_name = { stringValue: info.user_name };
      masks.push("updateMask.fieldPaths=user_name");
    }
    if (info.user_email && currentUserEmail !== info.user_email) {
      updates.user_email = { stringValue: info.user_email };
      masks.push("updateMask.fieldPaths=user_email");
    }
    if (info.group_name && currentGroupName !== info.group_name) {
      updates.group_name = { stringValue: info.group_name };
      masks.push("updateMask.fieldPaths=group_name");
    }
    if (masks.length > 0) {
      await firestoreRequest(env, "PATCH", `${docPath}?${masks.join("&")}`, {
        fields: updates,
      });
    }
    return collectionId;
  }

  // Create if missing
  const newFields = {
    chat_type: { stringValue: info.chat_type },
    employee_code: { stringValue: info.employee_code || "" },
    group_id: { stringValue: info.group_id || "" },
    group_name: { stringValue: info.group_name || "" },
    user_name: { stringValue: info.user_name || "" },
    user_email: { stringValue: info.user_email || "" },
    last_message_time: { stringValue: new Date().toISOString() },
    unread_count: { integerValue: "0" },
    status: { stringValue: "active" },
  };

  await firestoreRequest(env, "PATCH", `${docPath}`, { fields: newFields });
  return collectionId;
}

/**
 * Save message to Firestore and update conversation details
 */
async function saveMessage(env, convId, info) {
  const timestamp = new Date().toISOString();

  // Create message document
  await firestoreRequest(env, "POST", `/messages`, {
    fields: {
      conversation_id: { stringValue: convId },
      message_id: { stringValue: info.message_id || "" },
      sender: { stringValue: info.sender },
      sender_name: { stringValue: info.sender_name || "" },
      content: { stringValue: info.content || "" },
      message_type: { stringValue: info.tag || "text" },
      raw_message: { stringValue: info.raw_message || "" },
      thread_id: { stringValue: info.thread_id || "" },
      quoted_message_id: { stringValue: info.quoted_message_id || "" },
      employee_code: { stringValue: info.employee_code || "" },
      group_id: { stringValue: info.group_id || "" },
      is_auto_reply: { booleanValue: info.is_auto_reply || false },
      sent_at: { stringValue: timestamp },
    },
  });

  // Update conversation last message & unread
  const conv = await firestoreRequest(env, "GET", `/conversations/${convId}`);
  let unread = 0;
  if (conv && conv.fields && conv.fields.unread_count) {
    unread = parseInt(conv.fields.unread_count.integerValue || "0", 10);
  }

  if (!info.is_auto_reply && info.sender !== "admin") {
    unread += 1;
  } else {
    unread = 0;
  }

  await firestoreRequest(
    env,
    "PATCH",
    `/conversations/${convId}?updateMask.fieldPaths=last_message&updateMask.fieldPaths=last_message_time&updateMask.fieldPaths=unread_count`,
    {
      fields: {
        last_message: { stringValue: info.content.substring(0, 80) },
        last_message_time: { stringValue: timestamp },
        unread_count: { integerValue: unread.toString() },
      },
    },
  );
}

/**
 * Get values from Google Sheet
 */
async function getSheetValues(env, spreadsheetId, accessToken, range = "A:E") {
  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!${range}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const data = await res.json();
    return data.values || [];
  } catch (e) {
    console.error("Failed to read sheet", e);
    return [];
  }
}

/**
 * Get message by SeaTalk message_id from Firestore
 */
async function getMessageByMessageId(env, messageId) {
  const projectId = (env.FIREBASE_PROJECT_ID || "").trim();
  const apiKey = (env.FIREBASE_API_KEY || "").trim();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;

  const query = {
    structuredQuery: {
      from: [{ collectionId: "messages" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "message_id" },
          op: "EQUAL",
          value: { stringValue: messageId },
        },
      },
      limit: 1,
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && data[0].document) {
      return data[0].document;
    }
  } catch (e) {
    console.error("Failed to query message by ID", e);
  }
  return null;
}

// --- Auto Reply Logic with Firestore ---
async function findMatchingRule(env, messageText) {
  const rules = await firestoreRequest(env, "GET", "/rules");
  if (!rules || !rules.documents) return null;

  const lowerMsg = messageText.toLowerCase();

  for (const doc of rules.documents) {
    const rule = doc.fields;
    if (
      rule.is_active &&
      rule.is_active.booleanValue === true &&
      rule.trigger_type.stringValue === "keyword"
    ) {
      const keywordsStr = rule.keywords.stringValue;
      let keywords = [];
      try {
        keywords = JSON.parse(keywordsStr);
      } catch (e) {}

      const matchType = rule.match_type.stringValue;

      const matched = keywords.some((kw) => {
        const lowerKw = kw.toLowerCase();
        if (matchType === "exact") return lowerMsg === lowerKw;
        if (matchType === "starts_with") return lowerMsg.startsWith(lowerKw);
        return lowerMsg.includes(lowerKw); // default contains
      });

      if (matched) return rule.reply_message.stringValue;
    }
  }

  // Fallback
  const fallback = rules.documents.find(
    (d) =>
      d.fields.trigger_type &&
      d.fields.trigger_type.stringValue === "fallback" &&
      d.fields.is_active &&
      d.fields.is_active.booleanValue === true,
  );
  if (fallback) return fallback.fields.reply_message.stringValue;

  return null;
}

async function findEventRule(env, eventType) {
  const rules = await firestoreRequest(env, "GET", "/rules");
  if (!rules || !rules.documents) return null;
  const match = rules.documents.find(
    (d) =>
      d.fields.trigger_type &&
      d.fields.trigger_type.stringValue === eventType &&
      d.fields.is_active &&
      d.fields.is_active.booleanValue === true,
  );
  if (match) return match.fields.reply_message.stringValue;
  return null;
}

// --- SeaTalk Sending specific helpers ---
async function getEmployeeProfile(env, employeeCode) {
  const manualOverrides = {
    "e_ptv9p1zy": { email: "segagt505@shopeemobile-external.com" },
    "e_ppkznbk3": { email: "segagt497@shopeemobile-external.com" }
  };

  let defaultEmail = "";

  if (manualOverrides[employeeCode]) {
    defaultEmail = manualOverrides[employeeCode].email;
  }

  const result = { name: defaultEmail || employeeCode, email: defaultEmail, nickname: defaultEmail || employeeCode };
  try {
    const token = await getAccessToken(env);
    const res = await fetch(
      `${SEATALK_API}/contacts/v2/profile?employee_code=${employeeCode}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (res.ok) {
      const textBody = await res.text();
      const data = JSON.parse(textBody);
      await logEvent(env, "info", `Profile response for ${employeeCode}`, data);
      if (data.code === 0 && data.employees && data.employees.length > 0) {
        const emp = data.employees[0];
        result.email = emp.company_email || emp.email || defaultEmail;
        result.name = emp.en_name || emp.name || result.email;
        result.nickname = emp.en_name || emp.name || result.email;
      }
    }
  } catch (e) {
    await logEvent(env, "error", `Failed to fetch profile for ${employeeCode}`, { error: e.message });
  }
  return result;
}

async function sendPrivateMessage(env, employeeCode, text, messageObj, threadId) {
  const token = await getAccessToken(env);
  const messageData = messageObj ? messageObj : { tag: "text", text: { format: 1, content: text } };
  if (threadId) {
    messageData.thread_id = threadId;
    messageData.quoted_message_id = threadId; 
  }
  const res = await fetch(`${SEATALK_API}/messaging/v2/single_chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      employee_code: employeeCode,
      message: messageData,
    }),
  });

  const textBody = await res.text();
  let data;
  try {
    data = JSON.parse(textBody);
  } catch (e) {
    throw new Error(`SeaTalk API Error: Invalid JSON response: ${textBody}`);
  }

  if (data.code !== 0) {
    await logEvent(env, "error", "SeaTalk Send Private failed", {
      employeeCode,
      data,
    });
    throw new Error(
      `SeaTalk API Error: ${data.message || JSON.stringify(data)}`,
    );
  }
}

async function sendGroupMessage(env, groupId, text, threadId, messageObj) {
  const token = await getAccessToken(env);
  const messageData = messageObj ? messageObj : { tag: "text", text: { format: 1, content: text } };
  if (threadId) {
    messageData.thread_id = threadId;
    messageData.quoted_message_id = threadId; 
  }
  const body = {
    group_id: groupId,
    message: messageData,
  };

  const performFetch = () => fetch(`${SEATALK_API}/messaging/v2/group_chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let res = await performFetch();
  let textBody = await res.text();
  let data;
  try {
    data = JSON.parse(textBody);
  } catch (e) {
    throw new Error(`SeaTalk API Error: Invalid JSON response: ${textBody}`);
  }

  // Code 7000: Group chat not found. Might be a propagation delay right after bot is added.
  if (data.code === 7000) {
    await logEvent(env, "info", "Group chat not found, retrying in 2 seconds...", { groupId });
    await new Promise(resolve => setTimeout(resolve, 2000));
    res = await performFetch();
    textBody = await res.text();
    try {
      data = JSON.parse(textBody);
    } catch (e) {
      throw new Error(`SeaTalk API Error: Invalid JSON response: ${textBody}`);
    }
  }

  if (data.code !== 0) {
    await logEvent(env, "error", "SeaTalk Send Group failed", {
      data,
    });
    // We catch this inside the webhook handler so it doesn't crash
    throw new Error(
      `SeaTalk API Error: ${data.message || JSON.stringify(data)}`,
    );
  }
}

// --- Event Handlers ---
export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders });

    const url = new URL(request.url);

    try {
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
          const conversationsRes = await firestoreRequest(env, "GET", "/conversations");
          if (conversationsRes && conversationsRes.documents) {
            for (const doc of conversationsRes.documents) {
              const code = doc.fields?.employee_code?.stringValue;
              const uEmail = doc.fields?.user_email?.stringValue;
              const uName = doc.fields?.user_name?.stringValue;
              if (code) {
                empCodesToFetch.add(code);
                convInfoByCode.set(code, { email: uEmail, name: uName });
              }
            }
          }
        } catch (err) {
          await logEvent(env, "error", "Failed fetching conversations for contacts", { message: err.message });
        }

        // 3. Batch fetch employee profiles
        const uniqueEmp = [];
        let codesArr = Array.from(empCodesToFetch);

        if (codesArr.length > 0) {
          const profiles = [];
          for (let b = 0; b < codesArr.length; b += 50) {
             const batch = codesArr.slice(b, b + 50);
             const batchProfiles = await Promise.all(
               batch.map((c) => getEmployeeProfile(env, c))
             );
             profiles.push(...batchProfiles);
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

        let convId = conversation_id;
        if (convId && convId.startsWith("new_")) {
          convId = await ensureConversation(env, {
            chat_type,
            employee_code: chat_type === "private" ? target_id : "",
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
          await sendPrivateMessage(env, target_id, content, message_obj, thread_id);
        } else if (chat_type === "group") {
          await sendGroupMessage(env, target_id, content, thread_id, message_obj);
        }

        if (convId) {
          const tag = message_obj?.tag || "text";
          await saveMessage(env, convId, {
            sender: "admin",
            sender_name: "Admin",
            content,
            employee_code: chat_type === "private" ? target_id : "",
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

              const reply = await findMatchingRule(env, content);
              if (reply) {
                await logEvent(env, "info", "Sending auto-reply", {
                  employeeCode: event.employee_code,
                  reply,
                });
                const targetThreadId = event.message?.thread_id || event.message_id;
                await sendPrivateMessage(env, event.employee_code, reply, undefined, targetThreadId);
                await saveMessage(env, convId, {
                  sender: "bot",
                  sender_name: "Bot",
                  content: reply,
                  employee_code: event.employee_code,
                  is_auto_reply: true,
                  thread_id: targetThreadId,
                });
              } else {
                await logEvent(env, "info", "No matching rule found", {
                  content,
                });
              }
            }
          } else if (
            eventType === "new_mentioned_message_received_from_group_chat"
          ) {
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

              const reply = await findMatchingRule(env, content);
              if (reply) {
                await logEvent(env, "info", "Sending group auto-reply", {
                  groupId: event.group_id,
                  reply,
                });
                const targetThreadId = event.message?.thread_id || event.message_id;
                await sendGroupMessage(
                  env,
                  event.group_id,
                  reply,
                  targetThreadId,
                );
                await saveMessage(env, convId, {
                  sender: "bot",
                  sender_name: "Bot",
                  content: reply,
                  group_id: event.group_id,
                  thread_id: targetThreadId,
                  is_auto_reply: true,
                });
              } else {
                await logEvent(env, "info", "No matching group rule found", {
                  content,
                });
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
                  await sendGroupMessage(env, groupId, reply);
                  await saveMessage(env, convId, {
                    sender: "bot",
                    sender_name: "Bot",
                    content: reply,
                    group_id: groupId,
                    is_auto_reply: true,
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
};

```

## `server.ts`

```ts
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
    FOREIGN KEY(conversation_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS auto_reply_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_type TEXT,
    keywords TEXT,
    match_type TEXT,
    reply_message TEXT,
    is_active INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0
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

async function sendPrivateMessage(employeeCode: string, text: string) {
  const token = await getAccessToken();
  if (!token) return;
  await fetch(`${SEATALK_API}/messaging/v2/single_chat`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_code: employeeCode, message: { tag: 'text', text: { content: text } } }),
  });
}

async function sendGroupMessage(groupId: string, text: string, threadId?: string) {
  const token = await getAccessToken();
  if (!token) return;
  const messageData: any = { tag: 'text', text: { content: text } };
  if (threadId) messageData.thread_id = threadId;
  const body: any = { group_id: groupId, message: messageData };
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


function getAutoReply(text: string) {
  const rules = db.prepare('SELECT * FROM auto_reply_rules WHERE is_active = 1 ORDER BY priority DESC').all() as any[];
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
           await sendPrivateMessage(event.employee_code, rep);
           saveMessage((conv as any).id, { sender: 'bot', sender_name: 'Bot', content: rep, employee_code: event.employee_code, is_auto_reply: true });
         }
       }
    } else if (eventType === 'new_mentioned_message_received_from_group_chat') {
       const content = event.message?.text?.content;
       if (content) {
         const conv = ensureConversation({ chat_type: 'group', group_id: event.group_id, group_name: event.group_name || event.group_id });
         saveMessage((conv as any).id, { sender: 'user', sender_name: event.sender_employee_info?.en_name || event.employee_code, content, employee_code: event.employee_code, group_id: event.group_id, message_id: event.message_id });
         
         const rep = getAutoReply(content);
         if (rep) {
           await sendGroupMessage(event.group_id, rep, event.thread_id);
           saveMessage((conv as any).id, { sender: 'bot', sender_name: 'Bot', content: rep, group_id: event.group_id, is_auto_reply: true });
         }
       }
    } else if (eventType === 'user_enter_chatroom_with_bot') {
       const conv = ensureConversation({ chat_type: 'private', employee_code: event.employee_code, user_name: event.employee_code });
       const greetingRule = db.prepare('SELECT * FROM auto_reply_rules WHERE is_active = 1 AND trigger_type = "greeting"').get() as any;
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


// API Ext
app.get('/api/conversations', (req, res) => {
  const convs = db.prepare('SELECT * FROM conversations ORDER BY last_message_time DESC').all();
  res.json(convs);
});

app.get('/api/conversations/:id/messages', (req, res) => {
  const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC').all(req.params.id);
  db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(req.params.id);
  res.json(msgs);
});

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

app.get('/api/rules', (req, res) => {
  const rules = db.prepare('SELECT * FROM auto_reply_rules ORDER BY priority DESC').all();
  res.json(rules);
});

app.post('/api/rules', (req, res) => {
  const { trigger_type, keywords, match_type, reply_message, is_active, priority } = req.body;
  const insert = db.prepare(`INSERT INTO auto_reply_rules (trigger_type, keywords, match_type, reply_message, is_active, priority) VALUES (?, ?, ?, ?, ?, ?)`).run(trigger_type, keywords ? JSON.stringify(keywords) : '[]', match_type || 'contains', reply_message, is_active ? 1 : 0, priority || 0);
  res.json({ id: insert.lastInsertRowid });
});

app.delete('/api/rules/:id', (req, res) => {
  db.prepare('DELETE FROM auto_reply_rules WHERE id = ?').run(req.params.id);
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

```

## `src/App.tsx`

```tsx
import { useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Bot,
  Send,
  User,
  Menu,
  Settings,
  X,
  Plus,
  Trash2,
  CheckCircle2,
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  TextQuote,
  File,
  Image as ImageIcon,
  FileText,
  Blocks,
  Languages,
  ExternalLink,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Copy,
  Check,
  Edit2,
  MessageSquareQuote,
  AtSign,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

// Firebase imports
const markdownStructure = `# SeaTalk Bot Dashboard - Architecture & Structure

This document outlines the detailed file structure and architectural breakdown of the SeaTalk Bot Dashboard project.

## Directory Structure
\`\`\`text
/
├── cloudflare-worker.js         # Backend: Cloudflare Worker handling SeaTalk webhooks & APIs
├── server.ts                    # Backend: Node.js Express + Vite server for full-stack execution
├── src/                         # Frontend: React Application
│   ├── App.tsx                  # Core UI: SeaTalk dashboard, message builder, and settings
│   ├── main.tsx                 # Frontend entry point
│   ├── index.css                # Global Tailwind styles
│   └── lib/
│       └── utils.ts             # Tailwind CSS utility functions (cn)
├── components/                  # UI Components (shadcn/ui)
├── components.json              # shadcn/ui configuration
├── package.json                 # Project dependencies & scripts
├── vite.config.ts               # Vite configuration
├── tsconfig.json                # TypeScript configuration
├── index.html                   # HTML Entry template
├── metadata.json                # Project metadata/permissions
├── firebase-applet-config.json  # Firebase configuration details
├── .env.example                 # Required environment variables
└── README-Cloudflare.md         # Deployment instructions for the Cloudflare Worker
\`\`\`

## Architectural Components

### 1. Frontend (\`src/App.tsx\`)
A unified Single-Page Application (SPA) built with React and Tailwind CSS.
- **Chat Dashboard**: Integrates with backend endpoints to fetch recent SeaTalk messages and group chat streams. Shows message history with visual indicators for attachments.
- **Interactive Message Builder**: A robust UI for prototyping and deploying custom JSON interactive messages adhering to the SeaTalk Open Platform Layout Spec. Supports translations, interactive buttons, logic preview, and direct formulation.
- **Settings & Setup Guide**: Provides simple toggles and input fields for syncing the user's specific Google Apps script and Google Sheets webhook.

### 2. Backend API (\`cloudflare-worker.js\`)
Serves as the primary operational gateway between the frontend, the SeaTalk API, and external systems (Firebase/Google Sheets).
- **Webhook Listener**: Listens to SeaTalk Event Webhooks (\`interactive_message_click\`, \`bot_added_to_group_chat\`, \`message_from_bot_subscriber\`, etc.), acting as the main ingress point.
- **Message Dispatcher**: Constructs valid payloads for \`sendPrivateMessage\` and \`sendGroupMessage\`. Supports quoting via \`quoted_message_id\` and mentions.
- **Database Agent (Firestore)**: Writes message history logs directly to Firestore endpoints to create an audit/chat trail viewable by the admin.
- **Google Sheets Integrator**: Relays attendance and callback status metrics securely to Google Apps Script endpoints or direct Google Sheets APIs based on dynamic conditions.

### 3. Server Node (\`server.ts\`)
A lightweight Express proxy that spins up Vite middleware during development and provides asset serving in production scenarios.

## Flow Diagrams

- **User messages Bot**: \`SeaTalk -> Webhook Listener (cloudflare-worker.js) -> Firestore Data -> Bot Replies\`
- **Dashboard API**: \`React Frontend -> /api/dashboard/* -> Cloudflare Worker / Firestore -> Returns data stream to Admin UI\`
- **Interactive Button Click**: \`SeaTalk -> Webhook (bot) -> Logic Evaluation -> Appends to Google Sheet -> Bot gives feedback response.\`
`;

import {
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { db, auth, googleProvider } from "@/src/lib/firebase";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Add motion for animations
import { motion, AnimatePresence } from "motion/react";

// SET THIS to your Cloudflare Worker URL once deployed
const WORKER_URL = "https://testbotworker.jcruspero3263.workers.dev"; // e.g., https://seatalk-bot-webhook.username.workers.dev

export default function App() {
  const [activeTab, setActiveTab] = useState("chat");

  return (
    <div className="flex h-screen bg-neutral-50 overflow-hidden font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 overflow-hidden">
        {activeTab === "chat" && <ChatInterface />}
        {activeTab === "rules" && <AutoReplyRules />}
        {activeTab === "logs" && <LogsPanel />}
        {activeTab === "settings" && <SettingsPanel />}
      </main>
      <Toaster />
    </div>
  );
}

function Sidebar({
  activeTab,
  setActiveTab,
}: {
  activeTab: string;
  setActiveTab: (v: string) => void;
}) {
  return (
    <div className="w-16 md:w-64 bg-white border-r border-neutral-200 flex flex-col items-center md:items-stretch py-4 transition-all overflow-hidden shrink-0">
      <div className="px-4 mb-8 hidden md:flex items-center gap-2">
        <div className="bg-blue-600 p-1.5 rounded-lg text-white">
          <Bot size={20} />
        </div>
        <h1 className="font-bold text-lg text-neutral-900 tracking-tight">
          SeaTalk Manager
        </h1>
      </div>
      <div className="px-0 md:px-3 flex-1 flex flex-col gap-2">
        <NavButton
          icon={<MessageSquare size={20} />}
          label="Conversations"
          active={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
        />
        <NavButton
          icon={<Bot size={20} />}
          label="Auto Replies"
          active={activeTab === "rules"}
          onClick={() => setActiveTab("rules")}
        />
        <NavButton
          icon={<CheckCircle2 size={20} />}
          label="Logs"
          active={activeTab === "logs"}
          onClick={() => setActiveTab("logs")}
        />
        <NavButton
          icon={<Settings size={20} />}
          label="Setup Guide"
          active={activeTab === "settings"}
          onClick={() => setActiveTab("settings")}
        />
      </div>
    </div>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: any;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex justify-center md:justify-start items-center gap-3 p-3 md:px-4 rounded-xl transition-all w-full",
        active
          ? "bg-blue-50 text-blue-700 font-medium"
          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900",
      )}
    >
      {icon}
      <span className="hidden md:block whitespace-nowrap">{label}</span>
    </button>
  );
}

// --- Chat Interface ---
function ChatInterface() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Customizable Interactive Message Card Builder ---
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [builderLangMode, setBuilderLangMode] = useState<"single" | "dual">("single");
  const [activeBuilderTab, setActiveBuilderTab] = useState<"default" | "zh-Hans" | "code">("default");
  
  const [elementsDefault, setElementsDefault] = useState<any[]>([
    {
      element_type: "title",
      title: { text: "Daily Attendance" }
    },
    {
      element_type: "description",
      description: { format: 1, text: "Please click the button below to mark your attendance for today." }
    },
    {
      element_type: "button",
      button: { button_type: "callback", text: "Present", value: "at_present", sim_response: "✅ **Attendance Captured:** Your presence has been recorded." }
    }
  ]);

  const [elementsZh, setElementsZh] = useState<any[]>([
    {
      element_type: "title",
      title: { text: "每日出勤" }
    },
    {
      element_type: "description",
      description: { format: 1, text: "请点击下方按钮标记您今天的出勤状况。" }
    },
    {
      element_type: "button",
      button: { button_type: "callback", text: "到", value: "at_present", sim_response: "✅ **出勤已记录:** 您的出勤状况已成功记录。" }
    }
  ]);

  const getElementsList = () => {
    if (activeBuilderTab === "zh-Hans") return elementsZh;
    return elementsDefault;
  };

  const setElementsList = (updater: any[] | ((prev: any[]) => any[])) => {
    if (activeBuilderTab === "default") {
      setElementsDefault(updater);
    } else {
      setElementsZh(updater);
    }
  };

  const addElementToBuilder = (type: string) => {
    const current = getElementsList();
    
    // Limits
    const titleCount = current.filter(x => x.element_type === "title").length;
    const descCount = current.filter(x => x.element_type === "description").length;
    const buttonCount = current.filter(x => x.element_type === "button").length;
    const groupCount = current.filter(x => x.element_type === "button_group").length;
    const imageCount = current.filter(x => x.element_type === "image").length;

    if (type === "title" && titleCount >= 3) {
      toast.error("Limit exceeded: Max 3 Title elements allowed");
      return;
    }
    if (type === "description" && descCount >= 5) {
      toast.error("Limit exceeded: Max 5 Description elements allowed");
      return;
    }
    
    // total buttons is single buttons + child buttons in groups. Max is 5 buttons overall from SeaTalk API.
    let totalButtonsCount = buttonCount;
    current.forEach(el => {
      if (el.element_type === "button_group") {
        totalButtonsCount += (el.button_group || []).length;
      }
    });

    if (type === "button" && totalButtonsCount >= 5) {
      toast.error("Limit exceeded: Max 5 buttons in total allowed across card");
      return;
    }
    if (type === "button_group" && groupCount >= 3) {
      toast.error("Limit exceeded: Max 3 Button Groups allowed");
      return;
    }
    if (type === "image" && imageCount >= 3) {
      toast.error("Limit exceeded: Max 3 Image elements allowed");
      return;
    }

    let item: any = { element_type: type };
    if (type === "title") {
      item.title = { text: "New Title" };
    } else if (type === "description") {
      item.description = { format: 1, text: "New Description content goes here..." };
    } else if (type === "button") {
      item.button = { button_type: "callback", text: "New Button", value: "btn_callback_val" };
    } else if (type === "button_group") {
      item.button_group = [
        { button_type: "callback", text: "Button A", value: "btn_a_val" },
        { button_type: "callback", text: "Button B", value: "btn_b_val" }
      ];
    } else if (type === "image") {
      // standard 2x2 placeholder transparent or grey dot
      item.image = { content: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQYV2P8/uPnfwYGBgZGGAMAVe4H0WDm+2kAAAAASUVORK5CYII=" }; 
    }

    setElementsList([...current, item]);
    toast.success(`Added ${type} element`);
  };

  const removeElementFromBuilder = (idx: number) => {
    const current = getElementsList();
    const updated = current.filter((_, i) => i !== idx);
    setElementsList(updated);
    toast.success("Element removed");
  };

  const moveElementInBuilder = (idx: number, direction: "up" | "down") => {
    const current = [...getElementsList()];
    if (direction === "up" && idx > 0) {
      const temp = current[idx];
      current[idx] = current[idx - 1];
      current[idx - 1] = temp;
      setElementsList(current);
    } else if (direction === "down" && idx < current.length - 1) {
      const temp = current[idx];
      current[idx] = current[idx + 1];
      current[idx + 1] = temp;
      setElementsList(current);
    }
  };

  const updateElementField = (idx: number, elementUpdater: (el: any) => any) => {
    const current = [...getElementsList()];
    current[idx] = elementUpdater(current[idx]);
    setElementsList(current);
  };

  const handleBuilderImageUpload = (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("File limit exceeded: image must be less than 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64Str = ev.target?.result as string;
      const base64Data = base64Str.split(",")[1];
      updateElementField(idx, (el) => ({
        ...el,
        image: { ...el.image, content: base64Data }
      }));
      toast.success("Image uploaded successfully");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const loadGenericTemplate = () => {
    setElementsDefault([
      {
        element_type: "title",
        title: { text: "Basic Notification" }
      },
      {
        element_type: "description",
        description: { 
          format: 1, 
          text: "Here is a standard message. You can acknowledge it by clicking the button below." 
        }
      },
      {
        element_type: "button",
        button: {
          button_type: "callback", 
          text: "Acknowledge", 
          value: "ack",
          sim_response: "Thank you for acknowledging."
        }
      }
    ]);
    if (builderLangMode === "dual") {
      setElementsZh([
        {
          element_type: "title",
          title: { text: "基本通知" }
        },
        {
          element_type: "description",
          description: { 
            format: 1, 
            text: "这是一条标准消息。您可以点击下方按钮确认。" 
          }
        },
        {
          element_type: "button",
          button: {
            button_type: "callback", 
            text: "确认", 
            value: "ack",
            sim_response: "感谢您的确认。"
          }
        }
      ]);
    }
  };

  const loadAttendanceTemplate = () => {
    setElementsDefault([
      {
        element_type: "title",
        title: { text: "📢 @All 2AM" }
      },
      {
        element_type: "description",
        description: { 
          format: 1, 
          text: "Please fill out these forms if you're present or filing for RDOT/OT. If you haven't submitted your entry here, you may be marked as \"absent\" or \"off\".\n\n[Daily Attendance Form](https://forms.gle/8sZ9QEPs7oSEFJFk9)\n[RDOT/OT Form](https://forms.gle/EFhd8dDNJDhVZwdVA)" 
        }
      },
      {
        element_type: "button_group",
        button_group: [
          { 
            button_type: "callback", 
            text: "Mark Present", 
            value: "at_present",
            sim_response: "✅ **Attendance Logged:** Your profile (Name, Employee Code, Email) has been recorded in the attendance sheet."
          },
          { 
            button_type: "redirect", 
            text: "Full Form", 
            desktop_link: { type: "web", path: "https://forms.gle/8sZ9QEPs7oSEFJFk9" },
            mobile_link: { type: "web", path: "https://forms.gle/8sZ9QEPs7oSEFJFk9" }
          }
        ]
      }
    ]);
    setElementsZh([
      {
        element_type: "title",
        title: { text: "📢 @所有人 2AM" }
      },
      {
        element_type: "description",
        description: { 
          format: 1, 
          text: "如果您在岗或正在申请加班 (RDOT/OT)，请填写这些表格。如果您未在此提交记录，可能会被标记为“缺勤”或“休假”。\n\n[每日考勤表](https://forms.gle/8sZ9QEPs7oSEFJFk9)\n[RDOT/OT 申请表](https://forms.gle/EFhd8dDNJDhVZwdVA)" 
        }
      },
      {
        element_type: "button_group",
        button_group: [
          { 
            button_type: "callback", 
            text: "标记已到", 
            value: "at_present",
            sim_response: "✅ **考勤已记录：** 您的个人信息（姓名、编号、邮箱）已记录在考勤表中。"
          },
          { 
            button_type: "redirect", 
            text: "每日表格", 
            desktop_link: { type: "web", path: "https://forms.gle/8sZ9QEPs7oSEFJFk9" },
            mobile_link: { type: "web", path: "https://forms.gle/8sZ9QEPs7oSEFJFk9" }
          }
        ]
      }
    ]);
    toast.success("Loaded Attendance template!");
  };

  const handleInteractiveButtonClick = async (btn: any, messageId: string) => {
    console.log("Interactive button clicked:", { btn, messageId, activeConvId });
    
    if (!activeConvId) {
      toast.error("No active conversation selected to trigger client callbacks.");
      console.error("Callback triggered without active conversation");
      return;
    }

    if (btn.button_type === "redirect") {
      const desktopUrl = btn.desktop_link?.path || "https://";
      console.log("Redirecting to:", desktopUrl);
      toast.info(`Redirect Clicked!`);
      if (desktopUrl && desktopUrl.startsWith("http")) {
        window.open(desktopUrl, "_blank");
      }
      return;
    }

    if (btn.button_type === "callback") {
      const callbackValue = btn.value || "";
      const btnText = btn.text || "Action";
      
      console.log("Executing callback simulation for:", callbackValue);
      toast.loading(`Tapping "${btnText}"...`, { id: "callback-status" });

      try {
        // 1. Log the incoming callback action event to Firebase for audit logs
        await addDoc(collection(db, "logs"), {
          timestamp: new Date().toISOString(),
          level: "info",
          message: `Webhook Triggered: Button [${btnText}]`,
          details: JSON.stringify({
            event_type: "interactive_message_callback",
            callback_value: callbackValue,
            button_text: btnText,
            triggered_by_employee: "e_jane_thompson",
            conversation_id: activeConvId,
            message_id: messageId,
            status: "success",
            http_response_code: 200
          })
        });

        // 2. Format a reaction message
        let reactionMsg = "";
        
        // If we have a simulated response, use it as the primary content
        if (btn.sim_response) {
          reactionMsg = btn.sim_response;
        } else {
          // Default generic response matching standard behavior
          reactionMsg = `🤖 **SeaTalk Bot Callback Assistant**\n\nSuccessfully received callback event from button click:\n- **Button Title:** \`${btnText}\`\n- **Payload Value:** \`${callbackValue}\`\n\n`;
          
          if (callbackValue === "approve") {
            reactionMsg += "✅ **Leave Approved:** Jane Thompson's request has been **Approved** in HR records.";
          } else if (callbackValue === "reject") {
            reactionMsg += "❌ **Leave Rejected:** Request has been **Rejected** in ERP portal.";
          } else if (callbackValue === "collected") {
            reactionMsg += "📦 **Status Closed:** Parcel collection confirmed.";
          } else {
            reactionMsg += `⚙️ **Webhook OK (200):** Custom payload value \`${callbackValue}\` processed successfully.`;
          }
        }

        console.log("Construction reaction message:", reactionMsg);

        // 3. Post simulated response to messages store
        await addDoc(collection(db, "messages"), {
          conversation_id: activeConvId,
          message_id: `cb_sim_${Math.random().toString(36).substring(2, 11)}`,
          sender: "bot",
          sender_name: "App Server Webhook Link",
          content: reactionMsg,
          message_type: "text",
          is_auto_reply: true,
          sent_at: new Date().toISOString()
        });

        console.log("Simulated response added to Firestore");
        toast.dismiss("callback-status");
        toast.success("Callback processed successfully!");
      } catch (err: any) {
        console.error("Callback simulation failed:", err);
        toast.dismiss("callback-status");
        toast.error("Failed to execute callback simulation: " + err.message);
      }
    }
  };

  const sendCustomInteractiveMessage = async () => {
    const messageObj = {
      tag: "interactive_message",
      interactive_message: {
        elements: elementsDefault,
        ...(builderLangMode === "dual" ? {
          "zh-Hans": {
            elements: elementsZh
          }
        } : {})
      }
    };

    if (editingMessageId) {
      try {
        const msgRef = doc(db, "messages", editingMessageId);
        await updateDoc(msgRef, {
          raw_message: JSON.stringify(messageObj),
        });
        toast.success("Message card updated!");
        setIsBuilderOpen(false);
        setEditingMessageId(null);
      } catch (err: any) {
        toast.error("Failed to update: " + err.message);
      }
    } else {
      sendSpecialMessage(messageObj, "[Interactive Message]");
      setIsBuilderOpen(false);
      toast.success("Sent customizable interactive message!");
    }
  };

  const handleEditMessageCard = (m: any) => {
    try {
      const raw = JSON.parse(m.raw_message || "{}");
      const iMsg = raw.interactive_message;
      if (!iMsg) throw new Error("Invalid message card data");

      setElementsDefault(iMsg.elements || iMsg.default?.elements || []);
      if (iMsg["zh-Hans"]) {
        setElementsZh(iMsg["zh-Hans"].elements || []);
        setBuilderLangMode("dual");
      } else {
        setBuilderLangMode("single");
      }
      
      setEditingMessageId(m.id);
      setIsBuilderOpen(true);
      setActiveBuilderTab("default");
    } catch (err: any) {
      toast.error("Could not parse card for editing: " + err.message);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await fetch(
        `${WORKER_URL.replace(/\/$/, "")}/api/dashboard/contacts`,
      );
      if (res.ok) {
        const data = await res.json();
        setContacts([...(data.groups || []), ...(data.employees || [])]);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  // Listen to Firestore conversations
  useEffect(() => {
    try {
      const q = query(
        collection(db, "conversations"),
        orderBy("last_message_time", "desc"),
      );
      const unsub = onSnapshot(q, (snap) => {
        const convs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setConversations(convs);
        if (!activeConvId && convs.length > 0) {
          setActiveConvId(convs[0].id);
        }
      });
      return () => unsub();
    } catch (e) {
      console.log("Firebase not configured yet");
    }
  }, []);

  // Listen to Firestore messages
  useEffect(() => {
    if (!activeConvId) return;
    try {
      const q = query(collection(db, "messages"), orderBy("sent_at", "asc"));
      const unsub = onSnapshot(q, (snap) => {
        const msgs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((m: any) => m.conversation_id === activeConvId);

        // Delete group chat messages older than 24h
        const currentConv = conversations.find((c) => c.id === activeConvId);
        let validMsgs = msgs;

        if (currentConv && currentConv.chat_type === "group") {
          const now = Date.now();
          const oneDayMs = 24 * 60 * 60 * 1000;
          
          validMsgs = msgs.filter((m: any) => {
             const msgTime = new Date(m.sent_at).getTime();
             if (now - msgTime > oneDayMs) {
                // Delete asynchronously to save storage
                deleteDoc(doc(db, "messages", m.id)).catch(() => {});
                return false;
             }
             return true;
          });
        }

        setMessages(validMsgs);
        setTimeout(() => {
          if (scrollRef.current)
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 50);

        // Reset unread count
        updateDoc(doc(db, "conversations", activeConvId), {
          unread_count: 0,
        }).catch(() => {});
      });
      setLoading(false);
      return () => unsub();
    } catch (e) {}
  }, [activeConvId, conversations]);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const sendSpecialMessage = async (messageObj: any, defaultText: string) => {
    if (!activeConvId || !activeConv) return;
    try {
      const contact = contacts.find((co) => co.employee_code === activeConv.employee_code);
      const resolvedEmail = (contact?.email && !contact.email.endsWith("@seatalk.biz")) 
        ? contact.email 
        : (activeConv.user_email && !activeConv.user_email.endsWith("@seatalk.biz"))
        ? activeConv.user_email
        : contact?.email || activeConv.user_email || "";
      const resolvedName = (contact?.name && !contact.name.startsWith("e_")) 
        ? contact.name 
        : activeConv.user_name || contact?.name || "";

      const res = await fetch(
        `${WORKER_URL.replace(/\/$/, "")}/api/dashboard/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: activeConvId,
            chat_type: activeConv.chat_type,
            target_id:
              activeConv.chat_type === "private"
                ? activeConv.employee_code
                : activeConv.group_id,
            content: defaultText,
            user_name: resolvedName,
            user_email: resolvedEmail,
            group_name: activeConv.group_name || "",
            message_obj: messageObj,
            thread_id: replyThreadId || undefined,
          }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      setReplyThreadId(null);
      toast.success("Message sent successfully!");
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "file") => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64Str = ev.target?.result as string;
      const base64Data = base64Str.split(",")[1];
      
      let messageObj: any = {};
      if (type === "image") {
        messageObj = {
          tag: "image",
          image: { content: base64Data }
        };
      } else {
        messageObj = {
          tag: "file",
          file: { filename: file.name, content: base64Data }
        };
      }
      
      await sendSpecialMessage(messageObj, `[${type === "image" ? "Image" : "File"}]`);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const sendSampleInteractiveMessage = () => {
    const messageObj = {
      tag: "interactive_message",
      interactive_message: {
        elements: [
          {
            element_type: "title",
            title: { text: "Interactive Message Title" }
          },
          {
             element_type: "description",
             description: { format: 1, text: "This is a sample interactive message." }
          },
          {
             element_type: "button",
             button: { button_type: "callback", text: "Got it!", value: "ack" }
          }
        ]
      }
    };
    sendSpecialMessage(messageObj, "[Interactive Message]");
  };

  const insertFormat = (prefix: string, suffix: string = "") => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);

    let newText = "";
    let newCursorPosition = start;

    if (selected) {
      newText = before + prefix + selected + suffix + after;
      newCursorPosition =
        start + prefix.length + selected.length + suffix.length;
    } else {
      newText = before + prefix + suffix + after;
      newCursorPosition = start + prefix.length;
    }

    setInput(newText);

    // Focus and set cursor position after React re-renders
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
    }, 0);
  };

  const getDisplayName = (c: any) => {
    if (c.chat_type === "group") {
      const groupContact = contacts.find((co) => co.id === c.group_id);
      return c.group_name || groupContact?.name || "Group Chat";
    }
    const contact = contacts.find((co) => co.employee_code === c.employee_code);
    if (contact?.email && !contact.email.endsWith("@seatalk.biz")) {
      return contact.email;
    }
    if (c.user_email && !c.user_email.endsWith("@seatalk.biz")) {
      return c.user_email;
    }
    return contact?.email || c.user_email || c.user_name || "Unknown User";
  };

  const getDisplaySubName = (c: any) => {
    if (c.chat_type === "group") return "Group Chat";
    const contact = contacts.find((co) => co.employee_code === c.employee_code);
    if (contact?.email && !contact.email.endsWith("@seatalk.biz")) {
      return contact.email;
    }
    if (c.user_email && !c.user_email.endsWith("@seatalk.biz")) {
      return c.user_email;
    }
    return contact?.email || c.user_email || "Private Chat";
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeConvId || !activeConv) return;
    let txt = input;
    setInput("");
    
    // Auto-parse manual mentions
    txt = txt.replace(/@all\b/gi, "<mention></mention>");
    txt = txt.replace(/(^|\s)@([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g, "$1<mention email=\"$2\"></mention>");

    try {
      if (WORKER_URL.startsWith("http")) {
        const contact = contacts.find((co) => co.employee_code === activeConv.employee_code);
        const resolvedEmail = (contact?.email && !contact.email.endsWith("@seatalk.biz")) 
          ? contact.email 
          : (activeConv.user_email && !activeConv.user_email.endsWith("@seatalk.biz"))
          ? activeConv.user_email
          : contact?.email || activeConv.user_email || "";
        const resolvedName = (contact?.name && !contact.name.startsWith("e_")) 
          ? contact.name 
          : activeConv.user_name || contact?.name || "";

        const res = await fetch(
          `${WORKER_URL.replace(/\/$/, "")}/api/dashboard/send`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversation_id: activeConvId,
              chat_type: activeConv.chat_type,
              target_id:
                activeConv.chat_type === "private"
                  ? activeConv.employee_code
                  : activeConv.group_id,
              content: txt,
              user_name: resolvedName,
              user_email: resolvedEmail,
              group_name: activeConv.group_name || "",
              thread_id: replyThreadId || undefined,
            }),
          },
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text);
        }
        setReplyThreadId(null);
        const data = await res.json();
        if (data.conversation_id && data.conversation_id !== activeConvId) {
          setActiveConvId(data.conversation_id);
        }
      } else {
        toast.info(
          "Message saved locally. Deploy your worker to send it to SeaTalk!",
        );
      }
    } catch (e) {
      toast.error("Failed to send message: " + e);
    }
  };

  return (
    <div className="flex h-full bg-white relative">
      <div
        className={cn(
          "w-full md:w-80 border-r border-neutral-200 flex flex-col absolute md:static inset-0 bg-white z-10 transition-transform",
          activeConvId ? "-translate-x-full md:translate-x-0" : "translate-x-0",
        )}
      >
        <div className="p-4 border-b border-neutral-100 pb-4 flex justify-between items-center shrink-0">
          <h2 className="font-semibold text-lg">Inbox</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsNewChatOpen(true);
              fetchContacts();
            }}
          >
            <MessageSquare size={18} />
          </Button>
        </div>

        <Dialog open={isNewChatOpen} onOpenChange={setIsNewChatOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Conversation</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-sm text-neutral-500 mb-4">
                Select a known user or group from your connected bot
                interactions.
              </p>
              <Input
                placeholder="Search name, email, or ID..."
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="mb-2"
              />
              <ScrollArea className="h-[300px] border rounded-md p-2">
                {contacts.length === 0 ? (
                  <div className="text-center p-8 text-neutral-400 text-sm">
                    No contacts found. Have users interact with the bot first or
                    join a group.
                  </div>
                ) : (
                  contacts
                    .filter(
                      (c) =>
                        (c.name || "")
                          .toLowerCase()
                          .includes(contactSearch.toLowerCase()) ||
                        (c.email || "")
                          .toLowerCase()
                          .includes(contactSearch.toLowerCase())
                    )
                    .filter((c) => c.type === "group" || (c.email && !c.email.endsWith("@seatalk.biz")) || (c.name && !c.name.startsWith("e_")))
                    .map((c, i) => (
                      <button
                        key={i}
                        className="w-full text-left p-3 hover:bg-neutral-50 border-b last:border-0 rounded-sm mb-1 transition-colors flex items-center justify-between"
                        onClick={async () => {
                          try {
                            const res = await fetch(`${WORKER_URL.replace(/\/$/, "")}/api/dashboard/ensure_conversation`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                chat_type: c.type,
                                employee_code: c.employee_code || "",
                                user_name: c.name || "",
                                user_email: c.email || "",
                                group_id: c.id || "",
                                group_name: c.name || "",
                              })
                            });
                            const data = await res.json();
                            if (data.success && data.conversation_id) {
                               setActiveConvId(data.conversation_id);
                               setIsNewChatOpen(false);
                            } else {
                               toast.error("Failed to start conversation");
                            }
                          } catch (e) {
                             toast.error("Failed to start conversation");
                          }
                        }}
                      >
                        <div>
                          <div className="font-medium">
                            {c.type === "group"
                              ? c.name || c.id
                              : c.email || c.name || "Unknown User"}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {c.type === "group" ? "Group Chat" : "Private Chat"}
                          </div>
                        </div>
                        <Badge variant="secondary">{c.type}</Badge>
                      </button>
                    ))
                )}
              </ScrollArea>
            </div>
          </DialogContent>
        </Dialog>

        <ScrollArea className="flex-1">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveConvId(c.id)}
              className={cn(
                "w-full text-left p-4 hover:bg-neutral-50 border-b border-neutral-100 transition-colors",
                activeConvId === c.id ? "bg-blue-50/50" : "",
              )}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-medium text-neutral-900 truncate">
                  {getDisplayName(c)}
                </span>
                {c.unread_count > 0 && (
                  <Badge
                    variant="default"
                    className="bg-blue-600 rounded-full w-5 h-5 flex items-center justify-center p-0 text-[10px]"
                  >
                    {c.unread_count}
                  </Badge>
                )}
              </div>
              <div className="text-sm text-neutral-500 flex justify-between gap-2">
                <span className="truncate">
                  {c.last_message || "Started chat"}
                </span>
                <span className="text-xs whitespace-nowrap shrink-0">
                  {new Date(c.last_message_time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </button>
          ))}
          {conversations.length === 0 && (
            <div className="text-center p-8 text-neutral-400 text-sm">
              No conversations yet
            </div>
          )}
        </ScrollArea>
      </div>

      <div
        className={cn(
          "flex-1 flex flex-col absolute md:static inset-0 bg-white transition-transform",
          activeConvId ? "translate-x-0" : "translate-x-full md:translate-x-0",
        )}
      >
        {activeConv ? (
          <>
            <div className="h-16 px-4 border-b border-neutral-200 flex flex-row items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  className="md:hidden p-2 -ml-2 text-neutral-500"
                  onClick={() => setActiveConvId(null)}
                >
                  <Menu />
                </button>
                <div>
                  <h2 className="font-semibold text-neutral-900">
                    {getDisplayName(activeConv)}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {getDisplaySubName(activeConv)}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={async () => {
                  if (confirm("Delete this conversation (and all messages)?")) {
                    try {
                      const toDelete = messages.map((m) =>
                        deleteDoc(doc(db, "messages", m.id)),
                      );
                      await Promise.all(toDelete);
                      await deleteDoc(doc(db, "conversations", activeConv.id));
                      setActiveConvId(null);
                      toast.success("Conversation deleted.");
                    } catch (e) {
                      toast.error("Failed to delete: " + e);
                    }
                  }
                }}
              >
                Delete Chat
              </Button>
            </div>

            <div
              className="flex-1 p-4 overflow-y-auto bg-neutral-50/50"
              ref={scrollRef}
            >
              <div className="flex flex-col gap-4 max-w-3xl mx-auto">
                {messages.map((m, i) => {
                  const isMine = m.sender === "admin" || m.sender === "bot";
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex flex-col max-w-[75%]",
                        isMine ? "self-end items-end" : "self-start",
                      )}
                    >
                      <span className="text-xs text-neutral-400 mb-1 px-1">
                        {m.sender_name}{" "}
                        {m.is_auto_reply === 1 ? "(Auto-reply)" : ""}
                      </span>
                      <div
                        className={cn(
                          "p-3 rounded-2xl",
                          isMine
                            ? m.sender === "bot"
                              ? "bg-slate-700 text-white rounded-tr-sm"
                              : "bg-blue-600 text-white rounded-tr-sm"
                            : "bg-white border border-neutral-200 text-neutral-900 rounded-tl-sm shadow-sm",
                        )}
                      >
                        {m.quoted_message_id && (() => {
                          const quoted = messages.find(msg => msg.message_id === m.quoted_message_id);
                          return (
                            <div className={cn(
                              "text-[11px] rounded p-2 mb-2 border-l-2 opacity-80",
                              isMine ? (m.sender === "admin" ? "bg-black/10 border-white/50" : "bg-black/10 border-white/50") : "bg-neutral-100 border-neutral-300"
                            )}>
                              <div className="font-semibold mb-0.5">{quoted?.sender_name || "Unknown"}</div>
                              <div className="line-clamp-2">{quoted?.content || (quoted?.raw_message ? "Interactive Card" : "Attachment")}</div>
                            </div>
                          );
                        })()}
                        {m.message_type === "image" ? (
                          <img src={(() => {
                            const c = JSON.parse(m.raw_message || "{}")?.image?.content || "";
                            return c.startsWith("http") ? `${WORKER_URL.replace(/\/$/, "")}/api/dashboard/proxy-file?url=${encodeURIComponent(c)}` : `data:image/png;base64,${c}`;
                          })()} referrerPolicy="no-referrer" className="max-w-full rounded-md" />
                        ) : m.message_type === "video" ? (
                           <video src={(() => {
                            const c = JSON.parse(m.raw_message || "{}")?.video?.content || "";
                            return c.startsWith("http") ? `${WORKER_URL.replace(/\/$/, "")}/api/dashboard/proxy-file?url=${encodeURIComponent(c)}` : `data:video/mp4;base64,${c}`;
                          })()} controls className="max-w-full rounded-md" />
                        ) : m.message_type === "file" ? (
                           <a href={(() => {
                            const c = JSON.parse(m.raw_message || "{}")?.file?.content || "";
                            return c.startsWith("http") ? `${WORKER_URL.replace(/\/$/, "")}/api/dashboard/proxy-file?url=${encodeURIComponent(c)}` : `data:application/octet-stream;base64,${c}`;
                          })()} download={JSON.parse(m.raw_message || "{}")?.file?.filename} target="_blank" referrerPolicy="no-referrer" rel="noreferrer" className="underline underline-offset-2 flex items-center gap-2">
                             <File size={16} /> {JSON.parse(m.raw_message || "{}")?.file?.filename || "File"}
                           </a>
                        ) : m.message_type === "interactive_message" ? (
                           <div className="flex flex-col gap-2">
                             {/* render interactive message elements */}
                             {((JSON.parse(m.raw_message || "{}")?.interactive_message?.elements || JSON.parse(m.raw_message || "{}")?.interactive_message?.default?.elements || []) as any[]).map((el: any, idx: number) => (
                               <div key={idx}>
                                 {el.element_type === "title" && <strong className="block text-base md:text-lg font-bold text-neutral-900 tracking-tight leading-snug mb-1">{el.title?.text}</strong>}
                                 {el.element_type === "description" && <div className="text-sm text-neutral-600 mb-2 leading-relaxed whitespace-pre-wrap markdown-body [&>p]:mb-0 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>pre]:bg-black/10 [&>pre]:p-2 [&>pre]:rounded-md [&_code]:font-mono [&_code]:bg-black/10 [&_code]:px-1 [&_code]:rounded-sm leading-relaxed">{el.description?.format === 1 ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{el.description?.text}</ReactMarkdown> : el.description?.text}</div>}
                                 {el.element_type === "button" && (
                                   <button
                                     onClick={() => handleInteractiveButtonClick(el.button, m.id)}
                                     className="w-full py-2 px-3 border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 active:scale-[0.98] text-blue-600 font-semibold text-center text-xs md:text-sm rounded-xl flex items-center justify-center gap-1.5 my-1.5 cursor-pointer transition shadow-sm"
                                   >
                                     <span className="truncate">{el.button?.text}</span>
                                     {el.button?.button_type === "redirect" ? (
                                       <ExternalLink size={13} className="shrink-0 opacity-75 text-blue-500" />
                                     ) : (
                                       <Sparkles size={11} className="shrink-0 opacity-60 text-blue-500" />
                                     )}
                                   </button>
                                 )}
                                 {el.element_type === "button_group" && (
                                   <div className="flex gap-2 flex-row my-1.5 w-full">
                                     {(el.button_group || []).map((btn: any, bIdx: number) => (
                                       <button
                                         key={bIdx}
                                         onClick={() => handleInteractiveButtonClick(btn, m.id)}
                                         className="flex-1 py-1.5 px-2 border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 active:scale-[0.98] text-blue-600 font-semibold text-center text-[10px] md:text-xs rounded-xl flex items-center justify-center gap-1 overflow-hidden truncate cursor-pointer transition shadow-sm"
                                        >
                                         <span className="truncate">{btn.text}</span>
                                         {btn.button_type === "redirect" ? (
                                           <ExternalLink size={10} className="shrink-0 opacity-75 text-blue-500" />
                                         ) : (
                                           <Sparkles size={8} className="shrink-0 opacity-60 text-blue-500" />
                                         )}
                                       </button>
                                     ))}
                                   </div>
                                 )}
                                 {el.element_type === "image" && (
                                   <img
                                     src={el.image?.content?.startsWith("data:") || el.image?.content?.startsWith("http") ? el.image.content : `data:image/png;base64,${el.image?.content || ""}`}
                                     className="w-full h-auto max-h-48 object-cover rounded-lg border border-neutral-100 my-1 font-sans text-xs text-neutral-400"
                                     alt="Interactive content"
                                     referrerPolicy="no-referrer"
                                   />
                                 )}
                               </div>
                             ))}
                             <div className="mt-2 pt-2 border-t border-neutral-100 flex justify-between items-center text-[10px] text-neutral-400/80">
                               <span className="font-mono opacity-50">SeaTalk Card</span>
                               <button 
                                 onClick={() => handleEditMessageCard(m)}
                                 className="flex items-center gap-1 text-blue-400 hover:text-blue-200 transition-colors cursor-pointer font-semibold"
                               >
                                 <Edit2 size={10} /> Edit in Builder
                               </button>
                             </div>
                           </div>
                        ) : (
                          <div className="markdown-body whitespace-pre-wrap leading-relaxed [&>p]:mb-0 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>pre]:bg-black/10 [&>pre]:p-2 [&>pre]:rounded-md [&_code]:font-mono [&_code]:bg-black/10 [&_code]:px-1 [&_code]:rounded-sm">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {m.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 px-1">
                        <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                          {m.thread_id && m.thread_id !== m.message_id && (
                            <span className="text-blue-500 bg-blue-50 px-1 py-0.5 rounded flex items-center font-semibold" title={`Thread: ${m.thread_id}`}>
                              🧵 Thread Reply
                            </span>
                          )}
                          {new Date(m.sent_at).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })}{" "}
                          {new Date(m.sent_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <button
                          onClick={() => setReplyThreadId(m.thread_id || m.message_id)}
                          className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 font-medium transition-colors focus:outline-none"
                          title="Quote message"
                        >
                          <MessageSquareQuote size={10} /> Quote
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 bg-white border-t border-neutral-200 shrink-0">
              <div className="max-w-3xl mx-auto flex flex-col gap-2">
                <div
                  className="flex bg-neutral-100 rounded-md p-1 gap-1 items-center w-fit border border-neutral-200"
                  aria-label="Text formatting"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("**", "**")}
                    title="Bold"
                  >
                    <Bold size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("*", "*")}
                    title="Italic"
                  >
                    <Italic size={16} />
                  </Button>
                  <div className="w-px h-4 bg-neutral-300 mx-1"></div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("- ")}
                    title="Bulleted List"
                  >
                    <List size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("1. ")}
                    title="Numbered List"
                  >
                    <ListOrdered size={16} />
                  </Button>
                  <div className="w-px h-4 bg-neutral-300 mx-1"></div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("```\n", "\n```")}
                    title="Code Block"
                  >
                    <Code size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => insertFormat("> ")}
                    title="Quote"
                  >
                    <TextQuote size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50 bg-white border border-transparent hover:border-blue-200 ml-1 rounded-md transition-all shadow-sm shadow-blue-500/10"
                    onClick={() => insertFormat('<mention email="', '"></mention>')}
                    title="Mention (@email)"
                  >
                    <AtSign size={16} />
                  </Button>
                  <div className="w-px h-4 bg-neutral-300 mx-2"></div>
                  <input type="file" ref={imageInputRef} className="hidden" accept="image/png, image/jpeg, image/gif" onChange={(e) => handleFileUpload(e, "image")} />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => imageInputRef.current?.click()}
                    title="Send Image"
                  >
                    <ImageIcon size={16} />
                  </Button>
                  <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => handleFileUpload(e, "file")} />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-neutral-600 hover:bg-neutral-200"
                    onClick={() => fileInputRef.current?.click()}
                    title="Send File"
                  >
                    <FileText size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 w-8 p-0 hover:bg-neutral-200 transition-colors",
                      isBuilderOpen ? "text-blue-600 bg-blue-50" : "text-neutral-600"
                    )}
                    onClick={() => {
                      setEditingMessageId(null);
                      setIsBuilderOpen(true);
                    }}
                    title="Open Interactive Message Card Builder"
                  >
                    <Blocks size={16} />
                  </Button>
                </div>
                {replyThreadId && (
                  <div className="flex flex-col gap-1 mx-2 mb-2">
                    <div className="flex items-center justify-between bg-neutral-100 text-neutral-600 text-xs px-3 py-2 rounded-lg border-l-2 border-blue-500 shadow-sm relative pr-8">
                       <span className="flex items-center gap-1.5 truncate">
                         <MessageSquareQuote size={12} className="text-blue-500 shrink-0" />
                         <span className="truncate max-w-[200px] md:max-w-[400px]">
                           <strong>{messages.find(m => (m.thread_id || m.message_id) === replyThreadId)?.sender_name || "Unknown"}:</strong> {messages.find(m => (m.thread_id || m.message_id) === replyThreadId)?.content || "Message"}
                         </span>
                       </span>
                       <Button
                         variant="ghost"
                         size="sm"
                         className="h-5 w-5 p-0 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded bg-white absolute right-2"
                         onClick={() => setReplyThreadId(null)}
                         title="Cancel Quote"
                       >
                         <X size={12} />
                       </Button>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type a manual reply with Markdown..."
                    className="min-h-[44px] max-h-32 resize-none resize-y rounded-xl"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                      if (
                        (e.ctrlKey || e.metaKey) &&
                        (e.key === "b" || e.key === "B")
                      ) {
                        e.preventDefault();
                        insertFormat("**", "**");
                      }
                      if (
                        (e.ctrlKey || e.metaKey) &&
                        (e.key === "i" || e.key === "I")
                      ) {
                        e.preventDefault();
                        insertFormat("*", "*");
                      }
                    }}
                  />
                  <Button
                    onClick={sendMessage}
                    className="h-11 w-11 rounded-full shrink-0 self-end"
                    size="icon"
                  >
                    <Send size={18} className="translate-x-[1px]" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-400 hidden md:flex">
            Select a conversation to start chatting
          </div>
        )}
      </div>

      {/* Customizable Interactive Message Card Builder Dialog */}
      <Dialog open={isBuilderOpen} onOpenChange={setIsBuilderOpen}>
        <DialogContent className="sm:max-w-7xl w-[95vw] h-[90vh] flex flex-col p-0 overflow-hidden bg-white rounded-2xl border border-neutral-200">
          <DialogHeader className="shrink-0 border-b border-neutral-100 p-4 md:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl md:text-2xl font-bold text-neutral-950 flex items-center gap-2">
                <Sparkles className="text-blue-500" size={20} />
                SeaTalk Interactive Message Card Builder
              </DialogTitle>
              <p className="text-xs text-neutral-400 mt-1 max-w-md">
                Build and customize dynamic message cards matching the official SeaTalk Open Platform schema.
              </p>
            </div>
            
              <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 mr-2">
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest hidden sm:inline">Preserve:</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-semibold px-2.5 bg-white text-blue-600 border border-neutral-200 hover:bg-neutral-50 cursor-pointer flex items-center gap-1 shadow-sm"
                  onClick={loadGenericTemplate}
                >
                  <span>📝</span> Default
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-semibold px-2.5 bg-white text-blue-600 border border-neutral-200 hover:bg-neutral-50 cursor-pointer flex items-center gap-1 shadow-sm"
                  onClick={loadAttendanceTemplate}
                >
                  <span>📋</span> Form Callback
                </Button>
              </div>

              <div className="flex items-center gap-2 bg-neutral-100 p-1 rounded-lg">
                <Button
                  size="sm"
                  variant={activeBuilderTab !== "code" ? "secondary" : "ghost"}
                  className="text-xs py-1 px-3 h-7 rounded-md font-semibold"
                  onClick={() => {
                    if (activeBuilderTab === "code") setActiveBuilderTab("default");
                  }}
                >
                  Visual Builder
                </Button>
                <Button
                  size="sm"
                  variant={activeBuilderTab === "code" ? "secondary" : "ghost"}
                  className="text-xs py-1 px-3 h-7 rounded-md font-semibold flex items-center gap-1"
                  onClick={() => setActiveBuilderTab("code")}
                >
                  <Code size={13} />
                  Code JSON
                </Button>
              </div>

              <div className="flex items-center gap-2 bg-neutral-100 p-1 rounded-lg">
                <Button
                  size="sm"
                  variant={builderLangMode === "single" ? "secondary" : "ghost"}
                  className="text-xs py-1 px-3 h-7 rounded-md font-semibold"
                  onClick={() => {
                    setBuilderLangMode("single");
                    if (activeBuilderTab === "zh-Hans") setActiveBuilderTab("default");
                  }}
                >
                  Single
                </Button>
                <Button
                  size="sm"
                  variant={builderLangMode === "dual" ? "secondary" : "ghost"}
                  className="text-xs py-1 px-3 h-7 rounded-md font-semibold flex items-center gap-1"
                  onClick={() => setBuilderLangMode("dual")}
                >
                  <Languages size={13} />
                  Dual
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-6 p-4 md:p-6 overflow-hidden">
            {/* Left Column: Form Builder */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-neutral-50/50 rounded-xl border border-neutral-200 p-4">
              {activeBuilderTab === "code" ? (
                <div className="flex-1 flex flex-col gap-3">
                  <div className="flex justify-between items-center bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                    <span className="text-xs font-bold text-blue-700 uppercase tracking-widest flex items-center gap-2">
                      <Code size={14} /> RAW Message Schema Editor
                    </span>
                    <span className="text-[10px] text-blue-400">Official SeaTalk Open Platform Layout Spec</span>
                  </div>
                  <Textarea
                    className="flex-1 font-mono text-xs p-4 bg-neutral-900 text-green-400 rounded-xl resize-none whitespace-pre focus-visible:ring-blue-500"
                    value={JSON.stringify({
                      tag: "interactive_message",
                      interactive_message: {
                        elements: elementsDefault,
                        ...(builderLangMode === "dual" ? { "zh-Hans": { elements: elementsZh } } : {})
                      }
                    }, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        const iMsg = parsed.interactive_message;
                        if (iMsg) {
                          if (iMsg.elements) setElementsDefault(iMsg.elements);
                          else if (iMsg.default?.elements) setElementsDefault(iMsg.default.elements);
                          
                          if (iMsg["zh-Hans"]?.elements) {
                            setElementsZh(iMsg["zh-Hans"].elements);
                            setBuilderLangMode("dual");
                          }
                        }
                      } catch (err) {}
                    }}
                  />
                  <div className="text-[10px] text-neutral-400 italic">
                    Note: Changes here reflect in the visual builder and preview in real-time.
                  </div>
                </div>
              ) : (
                <>
                  {builderLangMode === "dual" && (
                <div className="flex border-b border-neutral-200 dark:border-neutral-800 mb-4 shrink-0">
                  <button
                    className={cn(
                      "py-2 px-4 text-sm font-semibold border-b-2 transition-all duration-200 focus:outline-none -mb-px",
                      activeBuilderTab === "default"
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-neutral-400 hover:text-neutral-600"
                    )}
                    onClick={() => setActiveBuilderTab("default")}
                  >
                    English Version (Default)
                  </button>
                  <button
                    className={cn(
                      "py-2 px-4 text-sm font-semibold border-b-2 transition-all duration-200 focus:outline-none -mb-px",
                      activeBuilderTab === "zh-Hans"
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-neutral-400 hover:text-neutral-600"
                    )}
                    onClick={() => setActiveBuilderTab("zh-Hans")}
                  >
                    Chinese Version (zh-Hans)
                  </button>
                </div>
              )}

              {/* Quick Adds Bar */}
              <div className="shrink-0 mb-4">
                <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider block mb-2">
                  Add Message Elements
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-neutral-700 bg-white hover:bg-neutral-50 cursor-pointer"
                    onClick={() => addElementToBuilder("title")}
                  >
                    <Plus size={14} className="mr-1" /> Title
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-neutral-700 bg-white hover:bg-neutral-50 cursor-pointer"
                    onClick={() => addElementToBuilder("description")}
                  >
                    <Plus size={14} className="mr-1" /> Description
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-neutral-700 bg-white hover:bg-neutral-50 cursor-pointer"
                    onClick={() => addElementToBuilder("button")}
                  >
                    <Plus size={14} className="mr-1" /> Button
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-neutral-700 bg-white hover:bg-neutral-50 cursor-pointer"
                    onClick={() => addElementToBuilder("button_group")}
                  >
                    <Plus size={14} className="mr-1" /> Button Group
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-neutral-700 bg-white hover:bg-neutral-50 cursor-pointer"
                    onClick={() => addElementToBuilder("image")}
                  >
                    <Plus size={14} className="mr-1" /> Image
                  </Button>
                </div>
                {/* Status counts / indicators */}
                <div className="flex gap-4 text-[10px] text-neutral-400 mt-2 font-mono">
                  <span>Titles: {getElementsList().filter(x => x.element_type === "title").length}/3</span>
                  <span>Descriptions: {getElementsList().filter(x => x.element_type === "description").length}/5</span>
                  <span>Buttons: {(() => {
                    let count = getElementsList().filter(x => x.element_type === "button").length;
                    getElementsList().forEach(x => {
                      if (x.element_type === "button_group") count += (x.button_group || []).length;
                    });
                    return count;
                  })()}/5</span>
                  <span>Groups: {getElementsList().filter(x => x.element_type === "button_group").length}/3</span>
                  <span>Images: {getElementsList().filter(x => x.element_type === "image").length}/3</span>
                </div>
              </div>

              {/* Draggable elements list scroll area */}
              <ScrollArea className="flex-1 min-h-0 pr-2">
                <div className="flex flex-col gap-3 pb-4">
                  {getElementsList().length === 0 ? (
                    <div className="text-center py-12 bg-neutral-100 rounded-xl border border-neutral-200">
                      <p className="text-sm text-neutral-400">No elements added yet. Click one of the buttons above to get started!</p>
                    </div>
                  ) : (
                    getElementsList().map((el, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-white rounded-xl border border-neutral-200 shadow-sm hover:shadow-md transition flex flex-col gap-3 relative"
                      >
                        {/* Header bar of element list item */}
                        <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded capitalize">
                              {el.element_type.replace("_", " ")}
                            </span>
                            <span className="text-[10px] text-neutral-400 font-mono">#{idx + 1}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={idx === 0}
                              className="h-6 w-6 text-neutral-500 hover:text-neutral-900 animate-none shrink-0"
                              onClick={() => moveElementInBuilder(idx, "up")}
                            >
                              <ArrowUp size={14} />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={idx === getElementsList().length - 1}
                              className="h-6 w-6 text-neutral-500 hover:text-neutral-900 animate-none shrink-0"
                              onClick={() => moveElementInBuilder(idx, "down")}
                            >
                              <ArrowDown size={14} />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50 animate-none shrink-0"
                              onClick={() => removeElementFromBuilder(idx)}
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </div>

                        {/* Content editor based on element_type */}
                        {el.element_type === "title" && (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex justify-between text-xs text-neutral-400">
                              <label className="font-semibold text-neutral-600">Title Text</label>
                              <span>{el.title?.text?.length || 0}/120</span>
                            </div>
                            <Input
                              value={el.title?.text || ""}
                              maxLength={120}
                              onChange={(e) => updateElementField(idx, (prev) => ({
                                ...prev,
                                title: { ...prev.title, text: e.target.value }
                              }))}
                              placeholder="e.g. Leave application request"
                              className="h-9 rounded-lg text-neutral-900"
                            />
                          </div>
                        )}

                        {el.element_type === "description" && (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-semibold text-neutral-600">Description Text</label>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-neutral-400 font-mono">{el.description?.text?.length || 0}/1000</span>
                                <div className="flex items-center border border-neutral-200 rounded overflow-hidden">
                                  <button
                                    className={cn(
                                      "text-[10px] px-1.5 py-0.5 cursor-pointer",
                                      el.description?.format === 2 ? "bg-blue-50 text-blue-600 font-semibold" : "bg-white text-neutral-400 hover:bg-neutral-50"
                                    )}
                                    onClick={() => updateElementField(idx, (prev) => ({
                                      ...prev,
                                      description: { ...prev.description, format: 2 }
                                    }))}
                                  >
                                    Plain
                                  </button>
                                  <button
                                    className={cn(
                                      "text-[10px] px-1.5 py-0.5 cursor-pointer",
                                      el.description?.format === 1 ? "bg-blue-50 text-blue-600 font-semibold" : "bg-white text-neutral-400 hover:bg-neutral-50"
                                    )}
                                    onClick={() => updateElementField(idx, (prev) => ({
                                      ...prev,
                                      description: { ...prev.description, format: 1 }
                                    }))}
                                  >
                                    Markdown
                                  </button>
                                </div>
                              </div>
                            </div>
                            <Textarea
                              value={el.description?.text || ""}
                              maxLength={1000}
                              onChange={(e) => updateElementField(idx, (prev) => ({
                                ...prev,
                                description: { ...prev.description, text: e.target.value }
                              }))}
                              placeholder={el.description?.format === 1 ? "Write descriptions supporting markdown: **Bold**, *Italics*" : "Plain-text description paragraphs"}
                              className="min-h-[70px] max-h-24 rounded-lg text-sm text-neutral-900"
                            />
                          </div>
                        )}

                        {el.element_type === "button" && (
                          <div className="flex flex-col gap-3">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-neutral-600">Button Type</label>
                                <Select
                                  value={el.button?.button_type || "callback"}
                                  onValueChange={(val) => updateElementField(idx, (prev) => {
                                    const base = { ...prev };
                                    base.button = { 
                                      button_type: val, 
                                      text: prev.button?.text || "New Button",
                                      ...(val === "callback" ? { value: "click_value" } : {
                                        mobile_link: { type: "web", path: "https://" },
                                        desktop_link: { type: "web", path: "https://" }
                                      })
                                    };
                                    return base;
                                  })}
                                >
                                  <SelectTrigger className="h-8 text-xs rounded-lg text-neutral-900">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="callback" className="text-xs">Callback (Server Webhook)</SelectItem>
                                    <SelectItem value="redirect" className="text-xs">Redirect (URL Path)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-xs text-neutral-400">
                                  <label className="font-semibold text-neutral-600">Button Label</label>
                                  <span>{el.button?.text?.length || 0}/50</span>
                                </div>
                                <Input
                                  value={el.button?.text || ""}
                                  maxLength={50}
                                  onChange={(e) => updateElementField(idx, (prev) => ({
                                    ...prev,
                                    button: { ...prev.button, text: e.target.value }
                                  }))}
                                  placeholder="Approve"
                                  className="h-8 text-xs rounded-lg text-neutral-900"
                                />
                              </div>
                            </div>

                            {el.button?.button_type === "callback" ? (
                              <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-xs text-neutral-400">
                                  <label className="font-semibold text-neutral-600">Callback Value</label>
                                  <span>{el.button?.value?.length || 0}/200</span>
                                </div>
                                <Input
                                  value={el.button?.value || ""}
                                  maxLength={200}
                                  onChange={(e) => updateElementField(idx, (prev) => ({
                                    ...prev,
                                    button: { ...prev.button, value: e.target.value }
                                  }))}
                                  placeholder="approve"
                                  className="h-8 text-xs rounded-lg font-mono text-neutral-900"
                                />
                              </div>
                            ) : (
                              <div className="border border-neutral-100 p-2 rounded-lg bg-neutral-50/50 flex flex-col gap-2">
                                <div className="flex flex-col gap-1">
                                  <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wide">Desktop URL Link</label>
                                  <Input
                                    value={el.button?.desktop_link?.path || ""}
                                    onChange={(e) => updateElementField(idx, (prev) => ({
                                      ...prev,
                                      button: {
                                        ...prev.button,
                                        desktop_link: { type: "web", path: e.target.value }
                                      }
                                    }))}
                                    placeholder="https://"
                                    className="h-7 text-xs rounded-lg bg-white text-neutral-900"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wide">Mobile Type</label>
                                    <Select
                                      value={el.button?.mobile_link?.type || "web"}
                                      onValueChange={(val) => updateElementField(idx, (prev) => ({
                                        ...prev,
                                        button: {
                                          ...prev.button,
                                          mobile_link: { 
                                            type: val, 
                                            path: prev.button?.mobile_link?.path || "https://" 
                                          }
                                        }
                                      }))}
                                    >
                                      <SelectTrigger className="h-7 text-xs rounded-lg bg-white text-neutral-900">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="web" className="text-[10px]">Web View</SelectItem>
                                        <SelectItem value="rn" className="text-[10px]">React Native Page</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wide">Mobile Path / Route</label>
                                    <Input
                                      value={el.button?.mobile_link?.path || ""}
                                      onChange={(e) => updateElementField(idx, (prev) => ({
                                        ...prev,
                                        button: {
                                          ...prev.button,
                                          mobile_link: {
                                            ...prev.button?.mobile_link,
                                            path: e.target.value
                                          }
                                        }
                                      }))}
                                      placeholder={el.button?.mobile_link?.type === "rn" ? "/pages/approve" : "https://"}
                                      className="h-7 text-xs rounded-lg bg-white text-neutral-900"
                                    />
                                  </div>
                                </div>
                              </div>
                            )}

                            {el.button?.button_type === "callback" && (
                              <div className="flex flex-col gap-1 mt-1 border-t border-dashed border-neutral-100 pt-2">
                                <div className="flex justify-between items-center mb-0.5">
                                  <label className="text-[10px] font-bold text-blue-600 uppercase flex items-center gap-1">
                                    <Sparkles size={10} /> Simulated Webhook Response (Markdown)
                                  </label>
                                </div>
                                <Textarea
                                  value={el.button?.sim_response || ""}
                                  onChange={(e) => updateElementField(idx, (prev) => ({
                                    ...prev,
                                    button: { ...prev.button, sim_response: e.target.value }
                                  }))}
                                  placeholder="e.g. ✅ Action completed successfully! Record updated."
                                  className="h-16 text-xs rounded-lg text-neutral-900 bg-blue-50/20 border-blue-100"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {el.element_type === "button_group" && (
                          <div className="flex flex-col gap-3">
                            <div className="flex justify-between items-center text-xs">
                              <label className="font-semibold text-neutral-600">Group Buttons (Max 3)</label>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] py-0 px-2 rounded-md hover:bg-neutral-100 cursor-pointer text-blue-600 font-semibold bg-white border border-neutral-200"
                                disabled={(el.button_group || []).length >= 3}
                                onClick={() => {
                                  const bGroup = [...(el.button_group || [])];
                                  bGroup.push({
                                    button_type: "callback",
                                    text: `Button ${bGroup.length + 1}`,
                                    value: `group_btn_${bGroup.length + 1}_val`
                                  });
                                  updateElementField(idx, (prev) => ({
                                    ...prev,
                                    button_group: bGroup
                                  }));
                                  toast.success("Button added to group");
                                }}
                              >
                                <Plus size={10} className="mr-0.5" /> Add Sub-Button
                              </Button>
                            </div>

                            <div className="flex flex-col gap-2">
                              {(el.button_group || []).map((subBtn: any, subIdx: number) => (
                                <div key={subIdx} className="border border-neutral-100/80 p-3 rounded-lg bg-neutral-50/30 flex flex-col gap-2 relative">
                                  <div className="flex items-center justify-between border-b border-dashed border-neutral-100 pb-1">
                                    <span className="text-[10px] font-bold text-neutral-500">Sub-Button #{subIdx + 1}</span>
                                    <button
                                      type="button"
                                      disabled={(el.button_group || []).length <= 1}
                                      className="text-[10px] text-red-500 hover:text-red-700 disabled:opacity-30"
                                      onClick={() => {
                                        const bGroup = (el.button_group || []).filter((_: any, sI: number) => sI !== subIdx);
                                        updateElementField(idx, (prev) => ({
                                          ...prev,
                                          button_group: bGroup
                                        }));
                                        toast.success("Sub-button removed");
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[9px] font-bold text-neutral-400">Type</label>
                                      <Select
                                        value={subBtn.button_type || "callback"}
                                        onValueChange={(val) => {
                                          const bGroup = [...(el.button_group || [])];
                                          bGroup[subIdx] = {
                                            button_type: val,
                                            text: subBtn.text || "Action",
                                            ...(val === "callback" ? { value: "action_click" } : {
                                              mobile_link: { type: "web", path: "https://" },
                                              desktop_link: { type: "web", path: "https://" }
                                            })
                                          };
                                          updateElementField(idx, (prev) => ({
                                            ...prev,
                                            button_group: bGroup
                                          }));
                                        }}
                                      >
                                        <SelectTrigger className="h-7 text-[10px] rounded-md bg-white text-neutral-900">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="callback" className="text-[10px]">Callback</SelectItem>
                                          <SelectItem value="redirect" className="text-[10px]">Redirect</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[9px] font-bold text-neutral-400">Label</label>
                                      <Input
                                        value={subBtn.text || ""}
                                        maxLength={50}
                                        onChange={(e) => {
                                          const bGroup = [...(el.button_group || [])];
                                          bGroup[subIdx].text = e.target.value;
                                          updateElementField(idx, (prev) => ({
                                            ...prev,
                                            button_group: bGroup
                                          }));
                                        }}
                                        className="h-7 text-xs rounded-md bg-white text-neutral-900"
                                      />
                                    </div>
                                  </div>

                                  {subBtn.button_type === "callback" ? (
                                    <div className="flex flex-col gap-0.5">
                                      <label className="text-[9px] font-bold text-neutral-400">Value</label>
                                      <Input
                                        value={subBtn.value || ""}
                                        maxLength={200}
                                        onChange={(e) => {
                                          const bGroup = [...(el.button_group || [])];
                                          bGroup[subIdx].value = e.target.value;
                                          updateElementField(idx, (prev) => ({
                                            ...prev,
                                            button_group: bGroup
                                          }));
                                        }}
                                        className="h-7 text-xs rounded-md bg-white font-mono text-neutral-900"
                                      />
                                    </div>
                                  ) : (
                                    <div className="flex flex-col gap-1 border-t border-dashed border-neutral-100 pt-1.5">
                                      <Input
                                        value={subBtn.desktop_link?.path || ""}
                                        onChange={(e) => {
                                          const bGroup = [...(el.button_group || [])];
                                          bGroup[subIdx].desktop_link = { type: "web", path: e.target.value };
                                          updateElementField(idx, (prev) => ({
                                            ...prev,
                                            button_group: bGroup
                                          }));
                                        }}
                                        placeholder="Desktop URL: https://"
                                        className="h-6 text-[10px] rounded bg-white text-neutral-900"
                                      />
                                      <Input
                                        value={subBtn.mobile_link?.path || ""}
                                        onChange={(e) => {
                                          const bGroup = [...(el.button_group || [])];
                                          bGroup[subIdx].mobile_link = { type: "web", path: e.target.value };
                                          updateElementField(idx, (prev) => ({
                                            ...prev,
                                            button_group: bGroup
                                          }));
                                        }}
                                        placeholder="Mobile URL: https://"
                                        className="h-6 text-[10px] rounded bg-white text-neutral-900"
                                      />
                                    </div>
                                  )}

                                  {subBtn.button_type === "callback" && (
                                    <div className="flex flex-col gap-1 border-t border-dashed border-neutral-100 pt-1.5 mt-0.5">
                                      <label className="text-[9px] font-bold text-blue-500 uppercase">Responded Action Msg</label>
                                      <Input
                                        value={subBtn.sim_response || ""}
                                        onChange={(e) => {
                                          const bGroup = [...(el.button_group || [])];
                                          bGroup[subIdx].sim_response = e.target.value;
                                          updateElementField(idx, (prev) => ({
                                            ...prev,
                                            button_group: bGroup
                                          }));
                                        }}
                                        placeholder="Simulation reply..."
                                        className="h-6 text-[10px] rounded bg-blue-50/30 text-neutral-900 border-blue-100/50"
                                      />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {el.element_type === "image" && (
                          <div className="flex flex-col gap-2">
                            <label className="text-xs font-semibold text-neutral-600">Select Image (Upload or External URL)</label>
                            <div className="grid grid-cols-1 gap-2">
                              <div className="border border-neutral-200 border-dashed rounded-lg p-3 bg-neutral-50/50 flex flex-col items-center gap-1.5">
                                <input
                                  type="file"
                                  accept="image/png, image/jpeg, image/gif"
                                  className="hidden"
                                  id={`builder-image-${idx}`}
                                  onChange={(e) => handleBuilderImageUpload(e, idx)}
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs bg-white text-neutral-700 border border-neutral-200 cursor-pointer shadow-sm hover:bg-neutral-50"
                                  onClick={() => {
                                    const selector = document.getElementById(`builder-image-${idx}`);
                                    selector?.click();
                                  }}
                                >
                                  Upload PNG/JPEG/GIF File
                                </Button>
                                <span className="text-[9px] text-neutral-400 font-sans">File size &lt;= 5MB</span>
                              </div>
                              
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-neutral-400 uppercase">Or Paste Image URL / Base64</label>
                                <Input
                                  value={el.image?.content && (el.image.content.startsWith("http") || el.image.content.startsWith("data:") ? el.image.content : "")}
                                  onChange={(e) => updateElementField(idx, (prev) => ({
                                    ...prev,
                                    image: { ...prev.image, content: e.target.value }
                                  }))}
                                  placeholder="e.g. https://domain.com/photo.png"
                                  className="h-8 text-xs rounded-lg text-neutral-900 bg-white"
                                />
                              </div>
                            </div>
                            
                            {el.image?.content && (
                              <div className="flex flex-col items-center gap-1 border border-neutral-100 p-2 rounded-lg bg-white mt-1">
                                <span className="text-[9px] font-mono text-neutral-400">Preview:</span>
                                <img
                                  src={el.image.content.startsWith("data:") || el.image.content.startsWith("http") ? el.image.content : `data:image/png;base64,${el.image.content}`}
                                  className="max-h-24 w-auto rounded object-contain border border-neutral-100"
                                  alt="Preview"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </div>

            {/* Right Column: iOS / SeaTalk Mobile Phone Preview + JSON inspection */}
            <div className="w-[360px] flex flex-col shrink-0 min-h-0 bg-neutral-900 rounded-2xl p-4 shadow-xl border border-neutral-800 text-white relative">
              {/* iOS Status header bar */}
              <div className="flex justify-between items-center text-[10px] text-neutral-400 font-mono px-2 mb-4 shrink-0">
                <span>SeaTalk Bot</span>
                <div className="w-12 h-3.5 bg-neutral-950 border border-neutral-800 rounded-full flex items-center justify-center">
                  <span className="text-[7px] text-amber-500">● </span>
                </div>
                <span>LTE 100%</span>
              </div>

              <ScrollArea className="flex-1 pr-1">
                <div className="flex flex-col gap-4 pb-4">
                  {/* Message Header */}
                  <div className="flex items-start gap-2 max-w-sm mt-3">
                    <div className="h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-sm shrink-0">
                      🤖
                    </div>
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-[10px] text-neutral-400 px-1 font-semibold text-left">Leave Application Bot</span>
                      
                      {/* Standard SeaTalk Card bubble Mockup */}
                      <div className="flex flex-col gap-2 w-[240px] bg-white border border-neutral-200 shadow-sm rounded-xl p-4 text-neutral-900 text-left">
                        {getElementsList().map((el, idx) => {
                          if (el.element_type === "title") {
                            return (
                              <strong key={idx} className="block text-base font-bold text-neutral-900 tracking-tight leading-snug mb-1 text-left">
                                {el.title?.text || "New Title"}
                              </strong>
                            );
                          }
                          if (el.element_type === "description") {
                            return (
                              <div key={idx} className="text-sm text-neutral-600 mb-2 leading-relaxed whitespace-pre-wrap markdown-body [&>p]:mb-0 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>pre]:bg-black/10 [&>pre]:p-2 [&>pre]:rounded-md [&_code]:font-mono [&_code]:bg-black/10 [&_code]:px-1 [&_code]:rounded-sm leading-relaxed text-left">
                                {el.description?.format === 1 ? (
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {el.description?.text || ""}
                                  </ReactMarkdown>
                                ) : (
                                  el.description?.text || ""
                                )}
                              </div>
                            );
                          }
                          if (el.element_type === "image") {
                            const contentSrc = el.image?.content || "";
                            const srcVal = contentSrc.startsWith("data:") || contentSrc.startsWith("http") ? contentSrc : `data:image/png;base64,${contentSrc}`;
                            return (
                              <img
                                key={idx}
                                src={srcVal}
                                className="w-full h-28 object-cover rounded-lg border border-neutral-100 my-1 bg-neutral-50/50"
                                alt="Preview Image"
                                referrerPolicy="no-referrer"
                              />
                            );
                          }
                           if (el.element_type === "button") {
                            return (
                              <button
                                key={idx}
                                onClick={() => handleInteractiveButtonClick(el.button, "builder-preview")}
                                className="w-full py-2 px-3 border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 active:scale-98 text-blue-600 font-semibold text-center text-xs rounded-xl flex items-center justify-center gap-1.5 my-1.5 cursor-pointer transition truncate shadow-sm"
                              >
                                <span className="truncate">{el.button?.text || "Action"}</span>
                                {el.button?.button_type === "redirect" ? (
                                  <ExternalLink size={12} className="shrink-0 opacity-70 text-blue-500" />
                                ) : (
                                  <Sparkles size={9} className="shrink-0 opacity-60 text-blue-500" />
                                )}
                              </button>
                            );
                          }
                          if (el.element_type === "button_group") {
                            const bGroup = el.button_group || [];
                            return (
                              <div key={idx} className="flex gap-2 flex-row my-1.5 max-w-full w-full">
                                {bGroup.map((btn: any, bIdx: number) => (
                                  <button
                                    key={bIdx}
                                    onClick={() => handleInteractiveButtonClick(btn, "builder-preview")}
                                    className="flex-1 py-1.5 px-2 border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 active:scale-98 text-blue-600 font-semibold text-center text-[10px] rounded-xl flex items-center justify-center gap-1 overflow-hidden truncate cursor-pointer transition shadow-sm"
                                  >
                                    <span className="truncate">{btn.text || "Btn"}</span>
                                    {btn.button_type === "redirect" ? (
                                      <ExternalLink size={9} className="opacity-70 shrink-0 text-blue-500" />
                                    ) : (
                                      <Sparkles size={8} className="shrink-0 opacity-60 text-blue-500" />
                                    )}
                                  </button>
                                ))}
                              </div>
                            );
                          }
                          return null;
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Payload code segment inspector */}
                  <div className="mt-4 border-t border-neutral-800 pt-4">
                    <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block mb-2">
                      SeaTalk JSON Schema Payload
                    </span>
                    <div className="bg-neutral-950 p-2 rounded-xl text-[9px] font-mono text-neutral-300 border border-neutral-800 overflow-x-auto max-h-40 relative group text-left">
                      <pre className="whitespace-pre text-left">
                        {JSON.stringify({
                          tag: "interactive_message",
                          interactive_message: {
                            elements: elementsDefault,
                            ...(builderLangMode === "dual" ? { "zh-Hans": { elements: elementsZh } } : {})
                          }
                        }, null, 2)}
                      </pre>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          const payloadJSON = JSON.stringify({
                            tag: "interactive_message",
                            interactive_message: {
                              default: { elements: elementsDefault },
                              ...(builderLangMode === "dual" ? { "zh-Hans": { elements: elementsZh } } : {})
                            }
                          }, null, 2);
                          navigator.clipboard.writeText(payloadJSON);
                          toast.success("Schema copied to clipboard!");
                        }}
                        className="h-6 w-6 absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-neutral-900 border border-neutral-800 text-neutral-400 hover:text-white rounded-md transition cursor-pointer"
                      >
                        <Copy size={12} />
                      </Button>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </div>
          </div>

          <DialogFooter className="shrink-0 p-4 md:px-6 md:py-4 border-t border-neutral-100 bg-neutral-50/50 flex flex-row items-center justify-end gap-3 rounded-b-2xl">
            <div className="flex-1 text-[10px] text-neutral-400 hidden md:block italic">
              SeaTalk cards are rendered as shown in the mobile preview.
            </div>
            <Button
              variant="ghost"
              className="text-neutral-500 hover:text-neutral-800 text-xs font-semibold h-9 px-4 cursor-pointer"
              onClick={() => setIsBuilderOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-blue-600 text-white hover:bg-blue-700 font-bold h-9 px-6 rounded-lg shadow-sm active:scale-95 transition flex items-center gap-2 cursor-pointer"
              onClick={sendCustomInteractiveMessage}
            >
              <Send size={15} />
              {editingMessageId ? "Save & Update Card" : "Send Designed Card"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Auto Reply Rules ---
function AutoReplyRules() {
  const [rules, setRules] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [triggerType, setTriggerType] = useState("keyword");
  const [keywords, setKeywords] = useState("");
  const [matchType, setMatchType] = useState("contains");
  const [replyMessage, setReplyMessage] = useState("");
  const [priority, setPriority] = useState("0");

  useEffect(() => {
    try {
      const q = query(collection(db, "rules"), orderBy("priority", "desc"));
      const unsub = onSnapshot(q, (snap) => {
        setRules(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      });
      return () => unsub();
    } catch (e) {}
  }, []);

  const addRule = async () => {
    try {
      await addDoc(collection(db, "rules"), {
        trigger_type: triggerType,
        keywords:
          triggerType === "keyword"
            ? JSON.stringify(
                keywords
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            : "[]",
        match_type: matchType,
        reply_message: replyMessage,
        is_active: true,
        priority: parseInt(priority) || 0,
      });
      setIsAddOpen(false);
      setKeywords("");
      setReplyMessage("");
      setPriority("0");
      toast.success("Rule added");
    } catch (e) {
      toast.error("Failed to add rule");
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await deleteDoc(doc(db, "rules", id));
      toast.success("Rule deleted");
    } catch (e) {
      toast.error("Failed to delete rule");
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10 bg-neutral-50/50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 mb-1">
              Auto-Replies
            </h1>
            <p className="text-sm text-neutral-500">
              Configure how the bot automatically responds to incoming messages.
            </p>
          </div>
          <Button className="gap-2" onClick={() => setIsAddOpen(true)}>
            <Plus size={16} /> New Rule
          </Button>
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Auto-Reply Rule</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Trigger Type</label>
                  <Select value={triggerType} onValueChange={setTriggerType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keyword">Keyword Match</SelectItem>
                      <SelectItem value="greeting">
                        Greeting (First Time)
                      </SelectItem>
                      <SelectItem value="fallback">
                        Fallback (No Match)
                      </SelectItem>
                      <SelectItem value="bot_added_to_group_chat">
                        Bot Added To Group Chat
                      </SelectItem>
                      <SelectItem value="bot_removed_from_group_chat">
                        Bot Removed From Group Chat
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {triggerType === "keyword" && (
                  <>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Keywords</label>
                      <Input
                        value={keywords}
                        onChange={(e) => setKeywords(e.target.value)}
                        placeholder="hello, help, support (comma separated)"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Match Type</label>
                      <Select value={matchType} onValueChange={setMatchType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="contains">
                            Contains (Recommended)
                          </SelectItem>
                          <SelectItem value="exact">Exact Match</SelectItem>
                          <SelectItem value="starts_with">
                            Starts With
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    Priority (Higher runs first)
                  </label>
                  <Input
                    type="number"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Reply Message</label>
                  <Textarea
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={4}
                    placeholder="Type the automated response..."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={addRule} disabled={!replyMessage}>
                  Save Rule
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex flex-col gap-4">
          {rules.length === 0 ? (
            <Card className="border-dashed border-2 shadow-none bg-transparent">
              <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                <Bot className="h-12 w-12 text-neutral-300 mb-4" />
                <h3 className="font-medium text-neutral-900 mb-1">
                  No rules configured
                </h3>
                <p className="text-sm text-neutral-500 mb-4">
                  Set up greeting, fallback, or keyword-based replies to start
                  engaging users automatically.
                </p>
                <Button variant="outline" onClick={() => setIsAddOpen(true)}>
                  Create your first rule
                </Button>
              </CardContent>
            </Card>
          ) : (
            rules.map((r) => (
              <Card key={r.id} className="overflow-hidden">
                <div className="flex flex-row">
                  <div
                    className={cn(
                      "w-2 shrink-0",
                      r.trigger_type === "fallback"
                        ? "bg-amber-400"
                        : r.trigger_type === "greeting"
                          ? "bg-purple-500"
                          : "bg-blue-500",
                    )}
                  />
                  <div className="p-5 flex-1 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                    <div className="flex-1">
                      <div className="flex gap-2 items-center mb-2">
                        <Badge
                          variant="secondary"
                          className="capitalize bg-neutral-100 text-neutral-700"
                        >
                          {r.trigger_type.replace(/_/g, " ")}
                        </Badge>
                        {r.trigger_type === "keyword" && (
                          <div className="flex gap-1 flex-wrap">
                            {JSON.parse(r.keywords).map((k: string) => (
                              <Badge
                                key={k}
                                variant="outline"
                                className="text-xs bg-white text-blue-700 border-blue-200"
                              >
                                "{k}"
                              </Badge>
                            ))}
                          </div>
                        )}
                        <span className="text-xs text-neutral-400">
                          Pri: {r.priority}
                        </span>
                      </div>
                      <p className="text-sm text-neutral-700 whitespace-pre-wrap bg-neutral-50 p-3 rounded-md border border-neutral-100 font-mono text-[13px]">
                        {r.reply_message}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                      onClick={() => handleDeleteRule(r.id)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function LogsPanel() {
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const q = query(collection(db, "logs"), orderBy("timestamp", "desc"));
      const unsub = onSnapshot(
        q,
        (snap) => {
          console.log("Logs snapshot received:", snap.size, "documents");
          setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setError(null);
        },
        (err) => {
          console.error("Logs error:", err);
          setError(err.message);
        },
      );
      return () => unsub();
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10 bg-neutral-50/50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900 mb-1">
              System Logs
            </h1>
            <p className="text-sm text-neutral-500">
              Real-time logs from your Cloudflare Worker to trace events.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const res = await fetch(`${WORKER_URL}/api/dashboard/send`, {
                    method: "POST",
                    body: JSON.stringify({ ping: true, testLog: true }),
                    headers: { "Content-Type": "application/json" },
                  });
                  const text = await res.text();
                  setError(`Ping result: ${res.status} ${text}`);
                } catch (e: any) {
                  setError(`Ping error: ${e.message}`);
                }
              }}
            >
              Ping Worker & Test Log
            </Button>
            <Button
              onClick={async () => {
                // Let's create a test log directly from client to verify permissions and collection
                try {
                  await addDoc(collection(db, "logs"), {
                    timestamp: new Date().toISOString(),
                    level: "info",
                    message: "Test log from UI (Verify Firebase is working)",
                    details: "{}",
                  });
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Create Test Log
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">
            <strong>Error loading logs:</strong> {error}
          </div>
        )}

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-neutral-500 uppercase bg-neutral-50 border-b border-neutral-100">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Level</th>
                  <th className="px-4 py-3 font-medium">Message</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-neutral-500"
                    >
                      Wait for events to be logged...
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr
                      key={l.id}
                      className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-neutral-500 text-xs">
                        {new Date(l.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0",
                            l.level === "info"
                              ? "text-blue-600 border-blue-200"
                              : l.level === "warning"
                                ? "text-amber-600 border-amber-200"
                                : "text-red-600 border-red-200",
                          )}
                        >
                          {l.level}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium text-neutral-700">
                        {l.message}
                      </td>
                      <td className="px-4 py-3">
                        <pre className="text-[10px] text-neutral-500 whitespace-pre-wrap font-mono break-all max-w-xs md:max-w-md bg-neutral-100 p-2 rounded">
                          {l.details}
                        </pre>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SettingsPanel() {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("1E3MrpeH-SjUEO2RanC1wJUsZdqcMkweY0CZMWpc51QM");
  const [appScriptUrl, setAppScriptUrl] = useState("https://script.google.com/macros/s/AKfycbwqNDjv85NLJSpPf9HorCh9ZXjkTmvNYEUjSoNFUqUNwai2WYCFNajqd_a3Gso_LRGh/exec");
  const [saving, setSaving] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setWebhookUrl(
      WORKER_URL +
        (WORKER_URL.endsWith("/") ? "" : "/") +
        "api/seatalk/webhook",
    );

    // Fetch existing spreadsheet ID from settings
    const unsub = onSnapshot(doc(db, "settings", "google_sheets"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setSpreadsheetId(data.spreadsheet_id || "1E3MrpeH-SjUEO2RanC1wJUsZdqcMkweY0CZMWpc51QM");
        setAppScriptUrl(data.app_script_url || "");
        setHasToken(!!data.access_token);
      }
    });
    return () => unsub();
  }, []);

  const handleGoogleAuth = async () => {
    setIsAuthorizing(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;
      
      if (token) {
        await updateDoc(doc(db, "settings", "google_sheets"), {
          access_token: token,
          token_timestamp: new Date().toISOString(),
          admin_email: result.user.email
        }).catch(async () => {
          const { setDoc } = await import("firebase/firestore");
          await setDoc(doc(db, "settings", "google_sheets"), {
            access_token: token,
            token_timestamp: new Date().toISOString(),
            admin_email: result.user.email,
            spreadsheet_id: spreadsheetId
          });
        });
        toast.success("Google Sheets authorization successful!");
      }
    } catch (e: any) {
      toast.error("Authorization failed: " + e.message);
    } finally {
      setIsAuthorizing(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "settings", "google_sheets"), {
        spreadsheet_id: spreadsheetId,
        app_script_url: appScriptUrl,
      }).catch(async () => {
        // Create if doesn't exist
        const { setDoc } = await import("firebase/firestore");
        await setDoc(doc(db, "settings", "google_sheets"), {
          spreadsheet_id: spreadsheetId,
          app_script_url: appScriptUrl,
        });
      });
      toast.success("Settings saved!");
    } catch (e) {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10 bg-neutral-50/50">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Configurations & Setup
          </h1>
          <Button
            variant="outline"
            className="flex items-center gap-2 text-blue-600 border-blue-200 hover:bg-blue-50/50"
            asChild
          >
            <a href="/seatalk-bot-structure.md" download="seatalk-bot-structure.md">
              <Download size={16} /> Download Full Code Dump
            </a>
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Languages size={20} className="text-green-600" />
              Google Sheets Integration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-neutral-600">
            <p>
              Connect your attendance tracking to a Google Sheet. When users click "Mark Present" in SeaTalk, the bot will log their details to this sheet.
            </p>
            
            <div className="space-y-4 pt-2">
              <div className="bg-neutral-100/50 p-4 rounded-lg space-y-3">
                <label className="text-xs font-bold text-neutral-700 uppercase block">Option A: Google Apps Script (Fastest Sync)</label>
                <div className="flex gap-2">
                  <Input 
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={appScriptUrl}
                    onChange={(e) => setAppScriptUrl(e.target.value)}
                    className="flex-1 text-xs bg-white"
                  />
                  <Button size="sm" onClick={saveSettings} disabled={saving}>
                    {saving ? "Saving..." : "Save URL"}
                  </Button>
                </div>
                <div className="bg-blue-50 p-3 rounded border border-blue-100 space-y-2">
                  <p className="text-[11px] font-medium text-blue-800">Apps Script Setup:</p>
                  <ol className="text-[10px] text-blue-700/80 list-decimal ml-4 space-y-1">
                    <li>Open your Sheet → <strong>Extensions</strong> → <strong>Apps Script</strong>.</li>
                    <li>Paste the code below into the editor and save.</li>
                    <li>Click <strong>Deploy</strong> → <strong>New Deployment</strong> → <strong>Web App</strong>.</li>
                    <li>Execute as: <strong>Me</strong>, Access: <strong>Anyone</strong>.</li>
                  </ol>
                  <div className="mt-2 p-1.5 bg-neutral-900 rounded overflow-x-auto">
                    <pre className="text-[9px] text-green-400 font-mono">
{`function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sheet1");
  var payload = JSON.parse(e.postData.contents);
  if (payload.action === "append") {
    var rows = sheet.getDataRange().getValues();
    var today = payload.dateKey || new Date().toLocaleDateString("en-US", {timeZone: "Asia/Manila"});
    var names = [];
    var isDuplicate = false;
    var empName = payload.data[1]; // Column B: Nickname

    for (var i = 1; i < rows.length; i++) {
       var rowDate = rows[i][2]; // Column C: Date
       var rowName = rows[i][1]; // Column B: Nickname
       if (rowDate === today) {
         names.push(rowName);
         if (rowName === empName) {
           isDuplicate = true;
         }
       }
    }
    
    if (!isDuplicate) {
      sheet.appendRow(payload.data);
      names.push(empName);
    }

    return ContentService.createTextOutput(JSON.stringify({status: isDuplicate ? "duplicate" : "ok", attendees: names}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="text-center text-neutral-300 text-xs font-bold py-1 italic">— OR —</div>

              <div className="bg-neutral-100/50 p-4 rounded-lg space-y-3">
                <label className="text-xs font-bold text-neutral-700 uppercase block">Option B: Direct Spreadsheet API (OAuth)</label>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs text-neutral-500 font-medium">1. Grant Access</p>
                    <Button 
                      onClick={handleGoogleAuth} 
                      disabled={isAuthorizing}
                      variant={hasToken ? "outline" : "default"}
                      size="sm"
                      className="w-full sm:w-auto flex items-center gap-2"
                    >
                      <div className="w-4 h-4 bg-white rounded-full flex items-center justify-center p-0.5">
                        <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path></svg>
                      </div>
                      {isAuthorizing ? "Authorizing..." : hasToken ? "Authorized" : "Authorize Account"}
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-neutral-500 font-medium">2. Spreadsheet ID</p>
                    <div className="flex gap-2">
                      <Input 
                        placeholder="Paste Spreadsheet ID..."
                        value={spreadsheetId}
                        onChange={(e) => setSpreadsheetId(e.target.value)}
                        className="flex-1 text-xs bg-white"
                      />
                      <Button size="sm" onClick={saveSettings} disabled={saving}>
                        {saving ? "Save" : "Save"}
                      </Button>
                      {spreadsheetId && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="flex items-center gap-1 border-green-200 text-green-700 hover:bg-green-50"
                          onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, "_blank")}
                        >
                          <ExternalLink size={14} />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 space-y-3">
              <div className="flex items-start gap-3">
                <Sparkles className="text-blue-500 shrink-0 mt-0.5" size={18} />
                <div className="text-xs text-blue-800 leading-relaxed font-medium">
                  How to setup Google Sheets logging:
                </div>
              </div>
              <ul className="text-[11px] text-blue-700/80 list-disc ml-9 space-y-1">
                <li>Click <strong>Authorize</strong> to grant the bot permission to write to your account.</li>
                <li>Ensure the <strong>Google Sheets API</strong> is enabled in your Cloud Console.</li>
                <li>Create a new spreadsheet and paste its <strong>ID</strong> from the URL below.</li>
                <li>Make sure the sheet has headers in the first row (e.g. Timestamp, Name, ID, SeaTalkID, Email).</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings size={20} className="text-blue-600" />
              1. Link Webhook to SeaTalk
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-neutral-600">
            <p>
              To receive messages and send auto-replies, configure your
              Cloudflare Worker URL in your SeaTalk Developer Portal.
            </p>
            <div className="bg-neutral-900 text-green-400 font-mono text-sm p-4 rounded-lg break-all">
              {webhookUrl}
            </div>
            <ol className="list-decimal pl-5 space-y-2 mt-4 text-neutral-800">
              <li>
                Go to{" "}
                <a
                  href="https://open.seatalk.io/developer"
                  target="_blank"
                  className="text-blue-600 underline"
                >
                  SeaTalk Open Platform
                </a>
              </li>
              <li>Navigate to your App → Advanced Settings → Event Callback</li>
              <li>
                Click "Edit", paste your Cloudflare Worker URL, and click
                "Save".
              </li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ExternalLink size={20} className="text-neutral-600" />
              2. Export to Cloudflare
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-neutral-600 space-y-4">
            <p>Follow these steps to fully move off jcruspero3263.</p>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <CheckCircle2
                  className="text-green-500 mt-0.5 shrink-0"
                  size={18}
                />
                <div>
                  <strong className="text-neutral-900 block mb-1">
                    Export Project
                  </strong>
                  <span className="text-neutral-500">
                    Go to Settings in the jcruspero3263 IDE and Export the project
                    as a ZIP or to GitHub.
                  </span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2
                  className="text-green-500 mt-0.5 shrink-0"
                  size={18}
                />
                <div>
                  <strong className="text-neutral-900 block mb-1">
                    Follow README
                  </strong>
                  <span className="text-neutral-500">
                    Open <code>README-Cloudflare.md</code> in the project files
                    to see how to deploy the React dashboard to Cloudflare
                    Pages, and the Node Backend to Cloudflare Workers!
                  </span>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

```

## `package.json`

```json
{
  "name": "react-example",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist server.cjs",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@base-ui/react": "^1.4.1",
    "@fontsource-variable/geist": "^5.2.8",
    "@google/genai": "^1.29.0",
    "@tailwindcss/vite": "^4.1.14",
    "@types/react-syntax-highlighter": "^15.5.13",
    "@vitejs/plugin-react": "^5.0.4",
    "better-sqlite3": "^12.10.0",
    "class-variance-authority": "^0.7.1",
    "cors": "^2.8.6",
    "dotenv": "^17.4.2",
    "express": "^4.22.2",
    "firebase": "^12.13.0",
    "motion": "^12.23.24",
    "next-themes": "^0.4.6",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "react-markdown": "^10.1.0",
    "react-syntax-highlighter": "^16.1.1",
    "remark-gfm": "^4.0.1",
    "shadcn": "^4.7.0",
    "sonner": "^2.0.7",
    "tw-animate-css": "^1.4.0",
    "vite": "^6.2.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/cors": "^2.8.19",
    "@types/express": "^4.17.21",
    "@types/node": "^22.14.0",
    "autoprefixer": "^10.4.21",
    "clsx": "^2.1.1",
    "esbuild": "^0.25.0",
    "lucide-react": "^1.16.0",
    "tailwind-merge": "^3.6.0",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.21.0",
    "typescript": "~5.8.2",
    "vite": "^6.2.3"
  }
}

```

## `firebase-applet-config.json`

```json
{
  "projectId": "fir-web-codelab-44e26",
  "appId": "1:630501015155:web:6843aba7f8003e9bc23406",
  "apiKey": "AIzaSyB6QXqIOoM8NceP_Ya2xVK60pCoJGZzB9c",
  "authDomain": "fir-web-codelab-44e26.firebaseapp.com",
  "storageBucket": "fir-web-codelab-44e26.firebasestorage.app",
  "messagingSenderId": "630501015155",
  "measurementId": ""
}
```

## `metadata.json`

```json
{
  "name": "SeaTalk Attendance Bot",
  "description": "Interactive message builder and attendance logger for SeaTalk, integrated with Google Sheets.",
  "requestFramePermissions": [],
  "majorCapabilities": ["MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API"]
}

```

