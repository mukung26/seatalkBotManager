import re

with open('cloudflare-worker.js', 'r') as f:
    text = f.read()

text = text.replace("""      // 18.0 PUT /api/dashboard/messages/:id
      if (url.pathname === "/api/stream/init" && request.method === "POST") {""", """      // 18.0 PUT /api/dashboard/messages/:id
      if (url.pathname.startsWith("/api/dashboard/messages/") && request.method === "PUT") {
        try {
          const id = url.pathname.split("/").pop();
          const { message_id, content, chat_type, target_id } = await request.json();
          if (!id) throw new Error("Missing message DB ID");

          await ensureD1Tables(env.DB);
          const oldMsg = await env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(id).first();
          if (!oldMsg) throw new Error("Message not found in DB");

          await env.DB.prepare("UPDATE messages SET content = ? WHERE id = ?").bind(content, id).run();

          const token = await getAccessToken(env);
          if (token && message_id) {
            let actualEmployeeCode = target_id;
            if (chat_type === "private") {
              actualEmployeeCode = await resolveEmployeeCode(env, target_id);
            }
            await fetch(`${SEATALK_API}/messaging/v2/update`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message_id,
                message: { tag: "text", text: { format: 1, content } }
              }),
            });
          }
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
        }
      }

      if (url.pathname === "/api/stream/init" && request.method === "POST") {""")

with open('cloudflare-worker.js', 'w') as f:
    f.write(text)
