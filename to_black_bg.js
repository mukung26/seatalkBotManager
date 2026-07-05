import fs from 'fs';

let code = fs.readFileSync('src/App.tsx', 'utf8');

const replacements = {
  // Backgrounds
  'bg-\\[#0d0d0d\\]': 'bg-black',
  'bg-\\[#141414\\]': 'bg-[#111]',
  'bg-\\[#1a1a1a\\]': 'bg-[#222]',
  'bg-neutral-900': 'bg-black',
  'bg-[#0a0a0a]': 'bg-black',

  // Borders
  'border-\\[#222222\\]': 'border-[#222]',
  'border-\\[#333333\\]': 'border-[#333]',
  
  // Accents to give it a techy aesthetic glow sometimes
};

// Also apply font-sans across the board if not fully utilizing geist
for (const [pattern, dark] of Object.entries(replacements)) {
  code = code.replace(new RegExp(`${pattern}`, 'g'), dark);
}

// Ensure the outer wrapper is bg-black
code = code.replace(/<div className="flex flex-col h-screen overflow-hidden text-\[\#editeded\] bg-\[\#0a0a0a\]/g, '<div className="flex flex-col h-screen overflow-hidden text-neutral-200 bg-black');

fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx transformed successfully');
