import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/\/\/\$\//g, '/\\/$/');

fs.writeFileSync('src/App.tsx', code);
