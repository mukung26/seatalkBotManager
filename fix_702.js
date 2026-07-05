import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

const strFind = '          reactionMsg = `🤖 **SeaTalk Bot Callback Assistant**nnSuccessfully received callback event from button click:n- **Button Title:** `${btnText}`n- **Payload Value:** `${callbackValue}`nn`;';
const strReplace = "          reactionMsg = `🤖 **SeaTalk Bot Callback Assistant**\\n\\nSuccessfully received callback event from button click:\\n- **Button Title:** \\`${btnText}\\`\\n- **Payload Value:** \\`${callbackValue}\\`\\n\\n`;";

code = code.replace(strFind, strReplace);
fs.writeFileSync('src/App.tsx', code);
