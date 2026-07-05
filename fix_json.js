import fs from 'fs';

let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /body: JSON\.stringify\(\{\n\s*chat_type: c\.type,\n\s*email: c\.email \|\|\n\s*user_name: c\.name \|\|\n\s*user_email: c\.email \|\|\n\s*group_id: c\.id \|\|\n\s*group_name: c\.name \|\|\n\s*\}\),/g;

code = code.replace(regex, `body: JSON.stringify({
                                  chat_type: c.type,
                                  user_name: c.name || "",
                                  user_email: c.email || "",
                                  group_id: c.id || "",
                                  group_name: c.name || "",
                                }),`);

fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx transformed successfully');
