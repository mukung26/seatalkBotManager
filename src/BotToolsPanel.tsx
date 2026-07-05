import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AtSign, Terminal, Users, User, TextCursorInput, RefreshCw, Send, CheckCircle2, MessageSquare, Bot, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

export function BotToolsPanel() {
  const [activeTab, setActiveTab] = useState("employee");

  // Output logging
  const [logs, setLogs] = useState<{ time: string; api: string; response: string; error?: boolean }[]>([]);

  const addLog = (api: string, response: any, error = false) => {
    setLogs(prev => [{
      time: new Date().toLocaleTimeString(),
      api,
      response: typeof response === 'string' ? response : JSON.stringify(response, null, 2),
      error
    }, ...prev]);
  };

  const simulateApiCall = async (apiName: string, expectedOutput: any, payload?: any) => {
    toast.info(`Calling API: ${apiName}`);
    await new Promise(r => setTimeout(r, 600)); // Simulate network latency

    if (!payload?.valid && payload?.valid !== false) {
      toast.success(`${apiName} Executed successfully.`);
      addLog(apiName, expectedOutput);
    } else {
      toast.error(`${apiName} failed: invalid input.`);
      addLog(apiName, { error: "Invalid parameters provided." }, true);
    }
  };

  return (
    <div className="flex h-full text-white bg-[#0a0a0a]">
      {/* Configuration Sidebar */}
      <div className="w-[450px] flex flex-col border-r border-[#222] bg-[#111]">
        <div className="p-4 border-b border-[#222]">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Terminal size={16} /> SeaTalk Developer Toolkit
          </h2>
          <p className="text-xs text-[#888888] mt-1">
            Test Open Platform API scopes directly from the dashboard. Simulated for development environments.
          </p>
        </div>

        <div className="flex-1 flex flex-col pt-3">
          <div className="flex bg-transparent justify-start px-4 h-auto p-0 space-x-2 border-b border-[#222] pb-4">
            <button 
              onClick={() => setActiveTab('employee')}
              className={`flex items-center text-xs h-8 px-3 rounded-md transition-colors ${activeTab === 'employee' ? 'bg-[#222] text-white' : 'text-[#888] hover:text-white hover:bg-[#1a1a1a]'}`}>
              <User size={14} className="mr-1.5" /> Employee
            </button>
            <button 
              onClick={() => setActiveTab('groups')}
              className={`flex items-center text-xs h-8 px-3 rounded-md transition-colors ${activeTab === 'groups' ? 'bg-[#222] text-white' : 'text-[#888] hover:text-white hover:bg-[#1a1a1a]'}`}>
              <Users size={14} className="mr-1.5" /> Groups
            </button>
            <button 
              onClick={() => setActiveTab('bot')}
              className={`flex items-center text-xs h-8 px-3 rounded-md transition-colors ${activeTab === 'bot' ? 'bg-[#222] text-white' : 'text-[#888] hover:text-white hover:bg-[#1a1a1a]'}`}>
              <Bot size={14} className="mr-1.5" /> Bot & Msg
            </button>
          </div>

          <ScrollArea className="flex-1 p-4">
            {activeTab === 'employee' && (
              <div className="space-y-4">
              <ApiSection 
                title="Get Employee Code with Email" 
                desc="Get employee's employee_code by providing their email."
                action={() => simulateApiCall("Get Employee Code with Email", { employee_code: "EMP-001" })}
                buttonLabel="Get Code"
                 inputs={[{ label: "Email Address", placeholder: "employee@seatalk.biz" }]}
              />
               <ApiSection 
                title="Get Employee Status" 
                desc="Get the 'Employee Status' based on their Join/Termination Date."
                action={() => simulateApiCall("Get Employee Status", { status: "Active", joined_at: "2024-01-01" })}
                buttonLabel="Check Status"
                 inputs={[{ label: "Employee Code / ID", placeholder: "EMP-001" }]}
              />
               <ApiSection 
                title="Check Employee Existence" 
                desc="Verify employee existence in the organization."
                action={() => simulateApiCall("Check Employee Existence", { exists: true, user_id: "ST_ID_1020" })}
                buttonLabel="Verify Existence"
                 inputs={[{ label: "Query (Email or Phone)", placeholder: "..." }]}
              />
               <ApiSection 
                title="Get User Language Preference" 
                desc="Obtain user's language setting in SeaTalk."
                action={() => simulateApiCall("Get User Language Preference", { language_code: "en-US" })}
                buttonLabel="Get Preference"
                 inputs={[{ label: "SeaTalk User ID", placeholder: "uid_..." }]}
              />
              </div>
            )}

            {activeTab === 'groups' && (
              <div className="space-y-4">
              <ApiSection 
                title="Create Group Chat" 
                desc="Create a new group chat with your bot included."
                action={() => simulateApiCall("Create Group Chat", { group_id: "GRP_789xyz123", status: "success" })}
                buttonLabel="Create Group"
                 inputs={[
                   { label: "Group Name", placeholder: "Project Delta" },
                   { label: "Initial Members (Employee Codes, comma sep)", placeholder: "EMP-001, EMP-002" }
                 ]}
              />
              <ApiSection 
                title="Add / Remove Group Members" 
                desc="Manage members dynamically in a bot-joined group."
                action={() => simulateApiCall("Manage Group Members", { modifiedCount: 1, status: "success" })}
                buttonLabel="Update Members"
                 inputs={[
                   { label: "Group ID", placeholder: "GRP_..." },
                   { label: "Member IDs", placeholder: "EMP-003" }
                 ]}
              />
              <ApiSection 
                title="Get Group Info" 
                desc="Obtain basic information about the group chat (name, settings, member list)."
                action={() => simulateApiCall("Get Group Info", { group_name: "Project Delta", member_count: 5, bot_is_admin: false })}
                buttonLabel="Fetch Info"
                 inputs={[{ label: "Group ID", placeholder: "GRP_..." }]}
              />
              <ApiSection 
                title="Get Joined Group Chat List" 
                desc="Obtain all group chats the bot currently participates in."
                action={() => simulateApiCall("Get Joined Group Chat List", {
                  groups: [
                    { group_id: "GRP_alpha", name: "Alpha Team" },
                    { group_id: "GRP_devs", name: "Engineering" }
                  ]
                })}
                buttonLabel="List Groups"
              />
              </div>
            )}

            {activeTab === 'bot' && (
              <div className="space-y-4">
              <ApiSection 
                title="Update Message" 
                desc="Update an interactive message sent previously using its message_id."
                action={() => simulateApiCall("Update Message", { success: true, updated_at: new Date().toISOString() })}
                buttonLabel="Apply Update"
                 inputs={[
                   { label: "Message ID", placeholder: "msg_..." },
                   { label: "New JSON Content", placeholder: "{...}" }
                 ]}
              />
              <ApiSection 
                title="Set Typing Status" 
                desc="Set the 'Typing...' indicator in a private or group chat."
                action={() => simulateApiCall("Set Typing Status", { success: true })}
                buttonLabel="Send Typing Event"
                 inputs={[{ label: "Target ID (Private or Group)", placeholder: "GRP_... or uid_..." }]}
              />
               <ApiSection 
                title="Get Bot Subscriber List" 
                desc="Obtain the total list of users subscribing to this bot."
                action={() => simulateApiCall("Get Bot Subscriber List", {
                  total: 42,
                  subscribers: ["EMP-001", "EMP-002", "EMP-003"]
                })}
                buttonLabel="Fetch Subs"
              />
               <ApiSection 
                title="Get Message by Message ID" 
                desc="Retrieve exact message details and content from the API."
                action={() => simulateApiCall("Get Message", {
                  message_id: "msg_abc123",
                  sender: "EMP-001",
                  content: { text: "Hello from SeaTalk!" },
                  timestamp: Date.now()
                })}
                buttonLabel="Retrieve Message"
                 inputs={[{ label: "Message ID", placeholder: "msg_abc123" }]}
              />
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Emulator Results Panel */}
      <div className="flex-1 flex flex-col bg-[#050505]">
        <div className="p-4 border-b border-[#222] flex justify-between items-center">
          <h2 className="text-sm font-medium text-white">API Response Logs</h2>
          <Button variant="ghost" size="sm" onClick={() => setLogs([])} className="h-7 text-xs text-[#666]">
             Clear Logs
          </Button>
        </div>
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-4 max-w-4xl mx-auto flex flex-col-reverse">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[300px] text-[#444]">
                <Activity size={32} className="mb-4 opacity-50" />
                <p className="text-sm">Execute an API to see output responses.</p>
              </div>
            ) : (
                logs.map((log, i) => (
                  <div key={i} className="mb-4 font-mono text-xs overflow-hidden rounded-lg border border-[#222] bg-[#0a0a0a]">
                    <div className="flex items-center justify-between bg-[#111] px-4 py-2 border-b border-[#222]">
                      <div className="flex items-center gap-2">
                        {log.error ? <Badge variant="destructive">Error</Badge> : <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">200 OK</Badge>}
                        <span className="font-semibold text-[#ddd]">{log.api}</span>
                      </div>
                      <span className="text-[#666]">{log.time}</span>
                    </div>
                    <div className="p-4 overflow-x-auto">
                      <pre className={`${log.error ? 'text-red-400' : 'text-blue-400'}`}>{log.response}</pre>
                    </div>
                  </div>
                ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// Reusable component
function ApiSection({ title, desc, action, buttonLabel, inputs = [] }: any) {
  return (
    <Card className="bg-[#111] border-[#222] rounded-xl overflow-hidden shadow-none">
      <CardHeader className="p-4 pb-3 border-b border-[#222] bg-[#161616]">
        <CardTitle className="text-xs text-[#ececec]">{title}</CardTitle>
        <CardDescription className="text-[10px] text-[#888] mt-1 line-clamp-2">{desc}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {inputs.map((inp: any, idx: number) => (
          <div key={idx} className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold tracking-wider text-[#666]">{inp.label}</label>
            <Input className="h-8 bg-[#000] border-[#333] text-xs text-white placeholder:text-[#555] rounded-md" placeholder={inp.placeholder} />
          </div>
        ))}
        <Button onClick={action} className="w-full text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white rounded-md mt-2 shadow-sm font-semibold tracking-wide">
          {buttonLabel}
        </Button>
      </CardContent>
    </Card>
  );
}

// Dummy icon
function Activity(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.48 12H2" />
    </svg>
  )
}
