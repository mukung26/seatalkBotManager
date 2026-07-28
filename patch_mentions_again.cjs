const fs = require('fs');

function patchWorker() {
  let content = fs.readFileSync('cloudflare-worker.js', 'utf8');
  content = content.replace(
    /const replaced = val\.replace\(\/\(\^\|\\\\s\)@\(all\|所有人\)\(\?=\\s\|\$\|\[\.,!\?;:\]\)\/gi, '\$1<mention-tag target="seatalk:\/\/user\?id=0"\/>'\);/,
    'let replaced = val.replace(/(^|\\s)@(all|所有人)(?=\\s|$|[.,!?;:])/gi, \'$1<mention-tag target="seatalk://user?id=0"/>\');\n      replaced = replaced.replace(/(^|\\s)@([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\\.[a-zA-Z0-9_-]+)/g, \'$1<mention-tag target="seatalk://user?email=$2"/>\');'
  );
  fs.writeFileSync('cloudflare-worker.js', content);
}

function patchServer() {
  let content = fs.readFileSync('server.ts', 'utf8');
  content = content.replace(
    /const replaced = val\.replace\(\/\(\^\|\\\\s\)@\(all\|所有人\)\(\?=\\s\|\$\|\[\.,!\?;:\]\)\/gi, '\$1<mention-tag target="seatalk:\/\/user\?id=0"\/>'\);/,
    'let replaced = val.replace(/(^|\\s)@(all|所有人)(?=\\s|$|[.,!?;:])/gi, \'$1<mention-tag target="seatalk://user?id=0"/>\');\n      replaced = replaced.replace(/(^|\\s)@([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\\.[a-zA-Z0-9_-]+)/g, \'$1<mention-tag target="seatalk://user?email=$2"/>\');'
  );
  fs.writeFileSync('server.ts', content);
}

patchWorker();
patchServer();
