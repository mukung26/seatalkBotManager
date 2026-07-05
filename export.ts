import fs from "fs";

let firebaseConfig: any = {};
if (fs.existsSync("firebase-applet-config.json")) {
  firebaseConfig = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf8"));
}

const filesToRead = [
  "cloudflare-worker.js",
  "server.ts",
  "src/App.tsx",
  "package.json",
  "firebase-applet-config.json",
  "metadata.json"
];

let md = "# SeaTalk Bot - Full Code Dump\n\n";

// Environment variables
md += "## Environment Variables & Configuration\n\n";
md += "```json\n";
md += JSON.stringify({
  SEATALK_APP_ID: process.env.SEATALK_APP_ID || "not_set",
  SEATALK_APP_SECRET: process.env.SEATALK_APP_SECRET || "not_set",
  SEATALK_EVENT_SECRET: process.env.SEATALK_EVENT_SECRET || "not_set",
  FIREBASE_PROJECT_ID: firebaseConfig.projectId || process.env.FIREBASE_PROJECT_ID || "not_set",
  FIREBASE_API_KEY: firebaseConfig.apiKey || process.env.FIREBASE_API_KEY || "not_set",
}, null, 2);
md += "\n```\n\n";

for (const file of filesToRead) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    md += `## \`${file}\`\n\n`;
    const ext = file.split(".").pop();
    md += `\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
  }
}

if (!fs.existsSync("public")) fs.mkdirSync("public");
fs.writeFileSync("public/seatalk-bot-structure.md", md);
console.log("Dump created successfully!");
