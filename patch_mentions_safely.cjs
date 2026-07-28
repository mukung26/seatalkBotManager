const fs = require('fs');

const processMentionsFunc = `function processMentions(messageObj) {
  if (!messageObj) return messageObj;
  
  let hasAtAll = false;
  let mentionedEmails = new Set();
  
  const replaceStr = (val) => {
    if (typeof val !== 'string') return val;
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
  };

  const newObj = JSON.parse(JSON.stringify(messageObj));

  // Only apply to supported fields
  if (newObj.tag === "text" && newObj.text) {
    if (newObj.text.content) newObj.text.content = replaceStr(newObj.text.content);
  } else if (newObj.tag === "markdown" && newObj.markdown) {
    if (newObj.markdown.content) newObj.markdown.content = replaceStr(newObj.markdown.content);
  } else if (newObj.tag === "interactive_message" && newObj.interactive_message && Array.isArray(newObj.interactive_message.elements)) {
    newObj.interactive_message.elements.forEach(el => {
      if (el.element_type === "description" && el.description && el.description.text) {
        el.description.text = replaceStr(el.description.text);
        // Force format 1 (markdown) if there are mentions, otherwise SeaTalk ignores it!
        if (/<mention-tag/.test(el.description.text)) {
          el.description.format = 1;
        }
      }
    });
  }

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
  .replace('const replaceStr = (val) => {', 'const replaceStr = (val: string): string => {');


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
