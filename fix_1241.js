import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex = /activeConvId === c\.id \? "bg-\[#222\] text-white\/50" :\n\s*\)/g;
code = code.replace(regex, 'activeConvId === c.id ? "bg-[#222] text-white/50" : ""\n              )');

fs.writeFileSync('src/App.tsx', code);
