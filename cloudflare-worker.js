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
async function findMatchingRule(env, messageText, senderEmail = "", employeeCode = "", chatType = "private") {
  const rules = await firestoreRequest(env, "GET", "/rules");
  if (!rules || !rules.documents) return null;

  const lowerMsg = messageText.toString().trim();
  const lowerMsgComp = lowerMsg.toLowerCase();

  for (const doc of rules.documents) {
    const rule = doc.fields;
    if (
      rule.is_active &&
      rule.is_active.booleanValue === true &&
      rule.trigger_type.stringValue === "keyword"
    ) {
      // Permission Validation Check
      const permType = rule.permission_type?.stringValue || "everyone";
      if (permType === "group_admin") {
         if (chatType !== "group") {
           continue; 
         }
      } else if (permType === "specific_emails") {
         const allowedStr = rule.allowed_emails?.stringValue || "";
         if (allowedStr) {
           const allowed = allowedStr.split(",").map(e => e.trim().toLowerCase());
           const senderLower = (senderEmail || "").toLowerCase();
           if (!senderLower || !allowed.includes(senderLower)) {
              continue; 
           }
         }
      }

      const keywordsStr = rule.keywords.stringValue;
      let keywords = [];
      try {
        keywords = JSON.parse(keywordsStr);
      } catch (e) {}

      const matchType = rule.match_type?.stringValue || "contains";

      const matched = keywords.some((kw) => {
        const lowerKw = kw.toLowerCase();
        if (matchType === "exact") return lowerMsgComp === lowerKw;
        if (matchType === "starts_with") return lowerMsgComp.startsWith(lowerKw);
        if (matchType === "ends_with") return lowerMsgComp.endsWith(lowerKw);
        if (matchType === "regex") {
          try {
            const regex = new RegExp(kw, "i");
            return regex.test(lowerMsg);
          } catch (regErr) {
            return false;
          }
        }
        return lowerMsgComp.includes(lowerKw); // default contains
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

async function resolveEmployeeCode(env, identifier) {
  if (!identifier || !identifier.includes("@")) return identifier;
  
  const manualOverrides = {
    "segagt505@shopeemobile-external.com": "e_ptv9p1zy",
    "segagt505@shopeemobilee-external.com": "e_ptv9p1zy", // typo fallback
    "segagt497@shopeemobile-external.com": "e_ppkznbk3",
    "jcruspero3263@gmail.com": "e_ptv9p1zy" // assuming the user is also mapped here, per UI
  };

  const lowerIdentifier = identifier.toLowerCase();
  
  // Return manual override if found
  if (manualOverrides[lowerIdentifier]) {
    return manualOverrides[lowerIdentifier];
  }
  
  try {
    const token = await getAccessToken(env);
    
    // Try POST /contacts/v2/get_employee_code_with_email
    const res = await fetch(`${SEATALK_API}/contacts/v2/get_employee_code_with_email`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}` 
      },
      body: JSON.stringify({ emails: [identifier] })
    });
    
    let rawResult = await res.text();
    await logEvent(env, "info", "Resolve Email Debug 1", { identifier, rawResult });
    
    let data;
    try { data = JSON.parse(rawResult); } catch(e){}

    if (data && data.code === 0 && data.employees) {
      for (const emp of data.employees) {
        if (emp.email === identifier || (emp.email || "").toLowerCase() === lowerIdentifier) {
           if (emp.employee_code && emp.employee_status !== 0) {
             return emp.employee_code;
           }
        }
      }
      if (data.employees.length > 0 && data.employees[0].employee_code) {
        return data.employees[0].employee_code;
      }
    }

    // Try GET profile with employee_code=email (fallback)
    const res2 = await fetch(`${SEATALK_API}/contacts/v2/profile?employee_code=${encodeURIComponent(identifier)}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` }
    });
    let rawResult2 = await res2.text();
    await logEvent(env, "info", "Resolve Email Debug 2", { identifier, rawResult2 });
    let data2;
    try { data2 = JSON.parse(rawResult2); } catch(e){}
    if (data2 && data2.code === 0 && data2.employee && data2.employee.employee_code) {
       return data2.employee.employee_code;
    }
  } catch (e) {
    await logEvent(env, "error", "Failed to resolve employee code for " + identifier, { error: e.message });
  }
  
  // As a final fallback if we are completely denied API access but need an email, 
  // wait and see if we can perform a heuristic fallback or just return identifier
  return identifier;
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

function processMessageMentions(messageObj) {
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

async function sendPrivateMessage(env, employeeCode, text, messageObj, threadId) {
  const token = await getAccessToken(env);
  let messageData = messageObj ? messageObj : { tag: "text", text: { format: 1, content: text } };
  messageData = processMessageMentions(messageData);
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
  let messageData = messageObj ? messageObj : { tag: "text", text: { format: 1, content: text } };
  messageData = processMessageMentions(messageData);
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

// --- Scheduled Broadcasts Handler for Cron Trigger ---
async function runScheduledBroadcasts(env) {
  try {
    await logEvent(env, "info", "Cron broadcast check started", {});

    const broadcastsRes = await firestoreRequest(env, "GET", "/broadcasts");
    if (!broadcastsRes || !broadcastsRes.documents) {
      await logEvent(env, "info", "Cron broadcast check: No broadcasts found or error fetching", {});
      return;
    }

    const utcNow = Date.now();
    const manilaOffsetMs = 8 * 60 * 60 * 1000;
    const manilaDate = new Date(utcNow + manilaOffsetMs);

    const manilaHours = manilaDate.getUTCHours();
    const manilaMinutes = manilaDate.getUTCMinutes();
    const dayIndex = manilaDate.getUTCDay();

    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const currentDayName = DAYS[dayIndex];
    const currentHHMM = `${manilaHours.toString().padStart(2, '0')}:${manilaMinutes.toString().padStart(2, '0')}`;
    const currentYYYYMMDD = `${manilaDate.getUTCFullYear()}-${(manilaDate.getUTCMonth() + 1).toString().padStart(2, '0')}-${manilaDate.getUTCDate().toString().padStart(2, '0')}`;

    console.log(`Cron check time: ${currentHHMM} on ${currentDayName}, date: ${currentYYYYMMDD}`);

    for (const doc of broadcastsRes.documents) {
      const fields = doc.fields;
      if (!fields) continue;

      const isActive = fields.is_active && fields.is_active.booleanValue === true;
      if (!isActive) continue;

      const name = fields.name?.stringValue || "Unnamed Broadcast";
      const interval = fields.interval?.stringValue || "manual_time";
      const chatType = fields.chat_type?.stringValue || "private";
      const targetId = fields.target_id?.stringValue || "";
      const msgType = fields.msg_type?.stringValue || "text";
      const content = fields.content?.stringValue || "";
      const scheduledTime = fields.scheduled_time?.stringValue || "";
      const scheduledDate = fields.scheduled_date?.stringValue || "";
      const lastRunAt = fields.last_run_at?.stringValue || "";

      let matches = false;

      if (interval === "manual_time") {
        matches = (scheduledTime === currentHHMM);
      } else if (interval === "weekly") {
        const parts = scheduledDate.split("T");
        const schedDay = parts[0] || "";
        const schedTime = parts[1] || "";
        matches = (schedDay === currentDayName && schedTime === currentHHMM);
      }

      if (matches) {
        // Double-run prevention (same minute run)
        if (lastRunAt && lastRunAt.includes(currentYYYYMMDD) && lastRunAt.includes(currentHHMM)) {
          console.log(`Broadcast "${name}" already executed in this minute. Skipping.`);
          continue;
        }

        console.log(`Triggering broadcast: ${name} to ${targetId}`);
        await logEvent(env, "info", `Triggering broadcast: ${name}`, { targetId, interval });

        let responseOk = false;
        let responseError = null;

        try {
          const { text: replyText, messageObj } = parseReplyMessage(content);

          const convId = await ensureConversation(env, {
            chat_type: chatType,
            employee_code: chatType === "private" ? await resolveEmployeeCode(env, targetId) : "",
            group_id: chatType === "group" ? targetId : "",
            group_name: chatType === "group" ? targetId : "",
          });

          if (chatType === "private") {
            const actualEmployeeCode = await resolveEmployeeCode(env, targetId);
            await sendPrivateMessage(env, actualEmployeeCode, replyText, messageObj);
          } else {
            await sendGroupMessage(env, targetId, replyText, undefined, messageObj);
          }

          const tag = messageObj?.tag || msgType || "text";
          await saveMessage(env, convId, {
            sender: "bot",
            sender_name: "Scheduler",
            content: replyText,
            employee_code: chatType === "private" ? await resolveEmployeeCode(env, targetId) : "",
            group_id: chatType === "group" ? targetId : "",
            is_auto_reply: false,
            tag,
            raw_message: messageObj ? JSON.stringify(messageObj) : ""
          });

          responseOk = true;
        } catch (sendErr) {
          responseError = sendErr.message;
          console.error(`Broadcast ${name} send error:`, sendErr);
        }

        // Update last_run_at
        const elapsedMsg = responseOk 
          ? `${currentHHMM} on ${currentYYYYMMDD} (Asia/Manila)`
          : `Failed on ${currentYYYYMMDD} at ${currentHHMM}: ${responseError}`;

        const nameParts = doc.name.split("/");
        const bId = nameParts[nameParts.length - 1];
        const docPath = `/broadcasts/${bId}`;

        try {
          await firestoreRequest(env, "PATCH", `${docPath}?updateMask.fieldPaths=last_run_at`, {
            fields: {
              last_run_at: { stringValue: elapsedMsg }
            }
          });
          console.log(`Updated last_run_at for ${name} to: ${elapsedMsg}`);
        } catch (patchErr) {
          console.error(`Failed to update last_run_at for ${name}:`, patchErr);
        }

        // Log results
        await logEvent(
          env, 
          responseOk ? "info" : "error", 
          `Broadcast "${name}" execute result`, 
          { responseOk, error: responseError }
        );
      }
    }
  } catch (cronErr) {
    console.error("Cron handler root error:", cronErr);
    await logEvent(env, "error", "Cron handler root error", { message: cronErr.message });
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
  
  // Try running the requested llama-3.3-70b model, with fallbacks to other models if it fails
  const models = [
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    '@cf/meta/llama-3.1-8b-instruct',
    '@cf/meta/llama-3-8b-instruct',
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
            content: "You are a friendly, professional Customer Service Assistant for Shopee Choice. Provide short, concise, and helpful answers. Do not use markdown formatting that isn't compatible with standard chat apps." 
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
