const fs = require('fs');
let code = fs.readFileSync('cloudflare-worker.js', 'utf8');
code = code.replace(' * - FIREBASE_API_KEY\n * - GEMINI_API_KEY', ' * - FIREBASE_API_KEY');
fs.writeFileSync('cloudflare-worker.js', code);
