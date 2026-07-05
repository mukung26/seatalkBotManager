import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');
const lines = code.split('\n');
lines[575] = "          text: `Please fill out these forms if you're present or filing for RDOT/OT. If you haven't submitted your entry here, you may be marked as \\\"absent\\\" or \\\"off\\\".\\n\\n[Daily Attendance Form](https://forms.gle/8sZ9QEPs7oSEFJFk9)\\n[RDOT/OT Form](https://forms.gle/EFhd8dDNJDhVZwdVA)`,";
code = lines.join('\n');
fs.writeFileSync('src/App.tsx', code);
