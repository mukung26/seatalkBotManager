import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

const regex4114 = /last_run_at:\n/;
code = code.replace(regex4114, 'last_run_at: null,\n');

code = code.replace(/text\[\#editeded\]/g, 'text-neutral-200');

// Fix the ternary operators on 4680, 4692, 4704, 4716.
code = code.replace(/hover:bg-indigo-700 text-\[\#ededed\] font-bold"\n\s*:\n\s*\)}/g, 'hover:bg-indigo-700 text-[#ededed] font-bold"\n                        : ""\n                    )}');

fs.writeFileSync('src/App.tsx', code);
