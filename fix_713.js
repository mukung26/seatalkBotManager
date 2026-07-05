import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

const strFind = '            reactionMsg += `⚙️ **Webhook OK (200):** Custom payload value `${callbackValue}` processed successfully.`;';
const strReplace = "            reactionMsg += `⚙️ **Webhook OK (200):** Custom payload value \\`${callbackValue}\\` processed successfully.`;";

code = code.replace(strFind, strReplace);
fs.writeFileSync('src/App.tsx', code);
