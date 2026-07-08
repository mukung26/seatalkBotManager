// Client REST API client for SeaTalk Bot Dashboard D1 database.
// This replaces direct Firebase Firestore SDK interactions.

export const WORKER_URL = "https://testbotworker.jcruspero3263.workers.dev";

// Determine the API base URL based on the environment
export const getApiUrl = (path: string): string => {
  return `${WORKER_URL.replace(/\/$/, "")}${path}`;
};

export const api = {
  // --- Conversations ---
  async getConversations() {
    const res = await fetch(getApiUrl("/api/dashboard/conversations"));
    if (!res.ok) throw new Error("Failed to fetch conversations");
    const json = await res.json() as any;
    return json.data || [];
  },

  async getMessages(conversationId: string | number) {
    const res = await fetch(getApiUrl(`/api/dashboard/conversations/${conversationId}/messages`));
    if (!res.ok) throw new Error("Failed to fetch messages");
    const json = await res.json() as any;
    return json.data || [];
  },

  async markRead(conversationId: string | number) {
    const res = await fetch(getApiUrl(`/api/dashboard/conversations/${conversationId}/mark-read`), {
      method: "POST"
    });
    if (!res.ok) throw new Error("Failed to mark conversation read");
    return await res.json();
  },

  async deleteConversation(conversationId: string | number) {
    const res = await fetch(getApiUrl(`/api/dashboard/conversations/${conversationId}`), {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Failed to delete conversation");
    return await res.json();
  },

  // --- Rules ---
  async getRules() {
    const res = await fetch(getApiUrl("/api/dashboard/rules"));
    if (!res.ok) throw new Error("Failed to fetch rules");
    const json = await res.json() as any;
    return json.data || [];
  },

  async createRule(rule: {
    trigger_type: string;
    keywords: string[];
    match_type: string;
    reply_message: string;
    is_active: boolean;
    priority: number;
  }) {
    const res = await fetch(getApiUrl("/api/dashboard/rules"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule)
    });
    if (!res.ok) throw new Error("Failed to create rule");
    const json = await res.json() as any;
    return json.id;
  },

  async updateRule(id: string, rule: {
    trigger_type: string;
    keywords: string[];
    match_type: string;
    reply_message: string;
    is_active: boolean;
    priority: number;
  }) {
    const res = await fetch(getApiUrl(`/api/dashboard/rules/${id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule)
    });
    if (!res.ok) throw new Error("Failed to update rule");
    return await res.json();
  },

  async deleteRule(id: string) {
    const res = await fetch(getApiUrl(`/api/dashboard/rules/${id}`), {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Failed to delete rule");
    return await res.json();
  },

  // --- Logs ---
  async getLogs() {
    const res = await fetch(getApiUrl("/api/dashboard/logs"));
    if (!res.ok) throw new Error("Failed to fetch logs");
    const json = await res.json() as any;
    return json.data || [];
  },

  async addLog(level: string, message: string, details: any = {}) {
    try {
      await fetch(getApiUrl("/api/dashboard/logs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level, message, details })
      });
    } catch (e) {
      console.error("Failed sending log:", e);
    }
  },

  async clearLogs() {
    const res = await fetch(getApiUrl("/api/dashboard/logs"), {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Failed to clear logs");
    return await res.json();
  },

  // --- Settings ---
  async getSettings() {
    const res = await fetch(getApiUrl("/api/dashboard/settings"));
    if (!res.ok) throw new Error("Failed to fetch settings");
    const json = await res.json() as any;
    return json.data || {};
  },

  async saveSetting(key: string, value: any) {
    const res = await fetch(getApiUrl("/api/dashboard/settings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value })
    });
    if (!res.ok) throw new Error("Failed to save setting");
    return await res.json();
  },

  // --- Broadcasts ---
  async getBroadcasts() {
    const res = await fetch(getApiUrl("/api/dashboard/broadcasts"));
    if (!res.ok) throw new Error("Failed to fetch broadcasts");
    const json = await res.json() as any;
    return json.data || [];
  },

  async createBroadcast(broadcast: {
    title: string;
    content: string;
    target_type: string;
    target_value: string;
    status: string;
    scheduled_at: string;
  }) {
    const res = await fetch(getApiUrl("/api/dashboard/broadcasts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(broadcast)
    });
    if (!res.ok) throw new Error("Failed to create broadcast");
    const json = await res.json() as any;
    return json.id;
  },

  async updateBroadcast(id: string, broadcast: {
    title: string;
    content: string;
    target_type: string;
    target_value: string;
    status: string;
    scheduled_at: string;
  }) {
    const res = await fetch(getApiUrl(`/api/dashboard/broadcasts/${id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(broadcast)
    });
    if (!res.ok) throw new Error("Failed to update broadcast");
    return await res.json();
  },

  async deleteBroadcast(id: string) {
    const res = await fetch(getApiUrl(`/api/dashboard/broadcasts/${id}`), {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Failed to delete broadcast");
    return await res.json();
  },

  // --- Single Messages ---
  async deleteMessage(messageId: string | number) {
    const res = await fetch(getApiUrl(`/api/dashboard/messages/${messageId}`), {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Failed to delete message");
    return await res.json();
  },

  async updateMessage(messageId: string | number, payload: { raw_message: string }) {
    const res = await fetch(getApiUrl(`/api/dashboard/messages/${messageId}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to update message");
    return await res.json();
  },

  // --- Send Active Message ---
  async sendMessage(payload: {
    conversation_id?: string | number;
    chat_type: string;
    target_id: string;
    content: string;
    user_name?: string;
    user_email?: string;
    group_name?: string;
    message_obj?: any;
    thread_id?: string;
    sender?: string;
    sender_name?: string;
    is_auto_reply?: boolean;
  }) {
    const res = await fetch(getApiUrl("/api/dashboard/send"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to send message");
    return await res.json() as { success: boolean; conversation_id: string | number };
  }
};
