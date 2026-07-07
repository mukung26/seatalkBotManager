const fs = require('fs');
let code = fs.readFileSync('cloudflare-worker.js', 'utf8');

const logEventFunc = `async function logEvent(env, level, message, details = {}) {
  try {
    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY) {
      console.log(\`[\${level}] \${message}\`, details);
      return;
    }
    const url = \`https://firestore.googleapis.com/v1/projects/\${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/logs?key=\${env.FIREBASE_API_KEY}\`;
    
    let detailsString = typeof details === 'object' ? JSON.stringify(details) : String(details);

    const document = {
      fields: {
        timestamp: { stringValue: new Date().toISOString() },
        level: { stringValue: level },
        message: { stringValue: message },
        details: { stringValue: detailsString }
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document)
    });
    
    if (!response.ok) {
      console.error("Firebase log failed:", await response.text());
    }
  } catch (err) {
    console.error("Error in logEvent:", err);
  }
}

`;

const targetStart = 'async function callCloudflareAI(env, messageText) {';
const startIndex = code.indexOf(targetStart);
if (startIndex !== -1) {
  code = code.substring(0, startIndex) + logEventFunc + code.substring(startIndex);
  fs.writeFileSync('cloudflare-worker.js', code);
  console.log("Added logEvent function");
} else {
  console.log("Could not find callCloudflareAI");
}
