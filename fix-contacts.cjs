const fs = require('fs');
let code = fs.readFileSync('cloudflare-worker.js', 'utf8');

const regex = /const profiles = \[\];[\s\S]*?const p = profiles\[i\];/;

const newLogic = `const profiles = [];
          for (let i = 0; i < codesArr.length; i++) {
            profiles.push({ name: codesArr[i], email: "" });
          }
          
          for (let i = 0; i < codesArr.length; i++) {
            const code = codesArr[i];
            const p = profiles[i];`;

code = code.replace(regex, newLogic);
fs.writeFileSync('cloudflare-worker.js', code);
