const fs = require('fs');
let content = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
content.triggers = {
  crons: ["* * * * *"]
};
fs.writeFileSync('wrangler.jsonc', JSON.stringify(content, null, 2));
