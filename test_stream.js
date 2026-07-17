async function initSeaTalkStream(env, chatType, targetId, threadId = null, quotedMessageId = null) {
  const token = await getAccessToken(env);
  const endpoint = chatType === "group"
    ? `${SEATALK_API}/messaging/v2/group_chat/init_stream`
    : `${SEATALK_API}/messaging/v2/single_chat/init_stream`;

  const body = {
    message: {
      tag: "text",
      text: {
        format: 1,
        content: "..."
      }
    }
  };

  let resolvedCode = targetId;
  if (chatType === "group") {
    body.group_id = targetId;
    if (threadId) body.message.thread_id = threadId;
    if (quotedMessageId) body.message.quoted_message_id = quotedMessageId;
  } else {
    resolvedCode = await resolveEmployeeCode(env, targetId);
    body.employee_code = resolvedCode;
    if (threadId) body.message.thread_id = threadId;
    if (quotedMessageId) body.message.quoted_message_id = quotedMessageId;
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.code === 0 && data.stream_id) {
      const streamId = data.stream_id;
      let seq = 1;
      let lastCallTime = 0;

      return async (fullContent, isFinal) => {
        const now = Date.now();
        if (!isFinal && now - lastCallTime < 250) return; // rate limit intermediate updates
        lastCallTime = now;

        const updateEndpoint = chatType === "group"
          ? `${SEATALK_API}/messaging/v2/group_chat/update_stream`
          : `${SEATALK_API}/messaging/v2/single_chat/update_stream`;

        const updateBody = {
          stream_id: streamId,
          seq: seq++,
          finish: isFinal,
          message: {
            text: {
              format: 1,
              content: fullContent
            }
          }
        };

        if (chatType === "group") {
          updateBody.group_id = targetId;
        } else {
          updateBody.employee_code = resolvedCode;
        }

        await fetch(updateEndpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(updateBody)
        });
      };
    }
  } catch (e) {
    console.error("Failed to init stream:", e);
  }
  return null;
}
