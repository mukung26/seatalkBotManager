import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /group_name: activeConv\.group_name \|\|(\s*)message_obj:/g;
code = code.replace(regex, 'group_name: activeConv.group_name || "",$1message_obj:');

const regex2 = /group_name: activeConv\.group_name \|\|(\s*)thread_id:/g;
code = code.replace(regex2, 'group_name: activeConv.group_name || "",$1thread_id:');

fs.writeFileSync('src/App.tsx', code);
