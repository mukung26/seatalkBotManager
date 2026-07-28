const fs = require('fs');

const processMentionsFunc = `function processMentions(messageObj) {
  if (!messageObj) return messageObj;
  
  let hasAtAll = false;
  let mentionedEmails = new Set();
  
  const replaceMentions = (val) => {
    if (typeof val === 'string') {
      let replaced = val.replace(/(^|\\s)@(all|所有人)(?=\\s|$|[.,!?;:])/gi, '$1<mention-tag target="seatalk://user?id=0"/>');
      replaced = replaced.replace(/(^|\\s)@([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\\.[a-zA-Z0-9_-]+)/g, '$1<mention-tag target="seatalk://user?email=$2"/>');
      
      const mentionRegex = /<mention\\s+email=["']([^"']+)["']>\\s*<\\/mention>/gi;
      replaced = replaced.replace(mentionRegex, (m, email) => \`<mention-tag target="seatalk://user?email=\${email}"/>\`);
      
      const oldAtAllRegex = /<mention>\\s*<\\/mention>/gi;
      replaced = replaced.replace(oldAtAllRegex, '<mention-tag target="seatalk://user?id=0"/>');

      if (/<mention-tag[^>]*id=["']?0["']?[^>]*>/.test(replaced) || /seatalk:\\/\\/user\\?id=0/.test(replaced)) {
        hasAtAll = true;
      }
      
      const emailMatch = /seatalk:\\/\\/user\\?email=([^"'>]+)/gi;
      let m;
      while ((m = emailMatch.exec(replaced)) !== null) {
        mentionedEmails.add(m[1]);
      }
      
      return replaced;
    }
    if (Array.isArray(val)) {
      return val.map(replaceMentions);
    }
    if (typeof val === 'object' && val !== null) {
      const newObj = {};
      for (const key in val) {
        newObj[key] = replaceMentions(val[key]);
      }
      return newObj;
    }
    return val;
  };

  const newObj = replaceMentions(messageObj);
  
  if (hasAtAll) {
    if (newObj.tag === "text" && newObj.text) newObj.text.at_all = true;
    else if (newObj.tag === "markdown" && newObj.markdown) newObj.markdown.at_all = true;
  }
  
  if (mentionedEmails.size > 0) {
    const emailsArray = Array.from(mentionedEmails);
    if (newObj.tag === "text" && newObj.text) {
      newObj.text.mentioned_email_list = [...new Set([...(newObj.text.mentioned_email_list || []), ...emailsArray])];
    } else if (newObj.tag === "markdown" && newObj.markdown) {
      newObj.markdown.mentioned_email_list = [...new Set([...(newObj.markdown.mentioned_email_list || []), ...emailsArray])];
    }
  }
  
  return newObj;
}
`;

const processMentionsTS = processMentionsFunc.replace('function processMentions(messageObj) {', 'function processMessageMentions(messageObj: any) {')
  .replace('const replaceMentions = (val) => {', 'const replaceMentions = (val: any): any => {')
  .replace('const newObj = {};', 'const newObj: any = {};');


function patchWorker() {
  let content = fs.readFileSync('cloudflare-worker.js', 'utf8');
  content = content.replace(/function processMentions\(messageObj\) \{[\s\S]*?\n\}\n/m, processMentionsFunc);
  fs.writeFileSync('cloudflare-worker.js', content);
}

function patchServer() {
  let content = fs.readFileSync('server.ts', 'utf8');
  content = content.replace(/function processMessageMentions\(messageObj: any\) \{[\s\S]*?\n\}\n/m, processMentionsTS);
  fs.writeFileSync('server.ts', content);
}

patchWorker();
patchServer();
