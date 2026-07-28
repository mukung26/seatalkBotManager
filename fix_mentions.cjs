const fs = require('fs');

function applyFix(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Remove my bad string replace:
  // body: JSON.stringify(body).replace(/<mention-tag target="seatalk:\/\/user\?id=0"\/>/g, '<mention-tag target="seatalk://all"/>')
  // body: JSON.stringify({ employee_code: resolvedCode, message: messageData }).replace(...)
  content = content.replace(
    /body: JSON\.stringify\((.*?)\)\.replace\(\/<mention-tag target="seatalk:\\\/\\\/user\\\?id=0"\\\/><mention-tag target="seatalk:\/\/all"\/>'\),/g,
    '' // Wait, my previous regex might have been broken, let's just do a simpler replace.
  );
  
  // Let's just reset the body strings manually
  content = content.replace(
    /\.replace\(\/<mention-tag target="seatalk:\\\/\\\/user\\\?id=0"\\\/>\/g, '<mention-tag target="seatalk:\/\/all"\/>'\)/g,
    ''
  );

  fs.writeFileSync(filePath, content);
}

applyFix('cloudflare-worker.js');
applyFix('server.ts');
