import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

const replacements = {
  'bg\-\\[#0d0d0d\\]': 'bg-[#0a0a0a]',
  'bg\-\\[#141414\\]': 'bg-[#111111]',
  'bg\-\\[#1a1a1a\\]': 'bg-[#1a1a1a]',
  'border-neutral-800': 'border-[#222]',
  'border-neutral-700': 'border-[#333]',
  'text-neutral-100': 'text-[#ededed]',
  'text-neutral-200': 'text-[#ececec]',
  'text-neutral-300': 'text-[#a1a1aa]',
  'text-neutral-400': 'text-[#888888]',
  'text-neutral-500': 'text-[#666666]',
  'shadow-none': 'shadow-sm',
  
  // Update sidebar colors specifically if any
  'bg-blue-600': 'bg-white',
  'text-blue-600': 'text-black',
  'text-blue-500': 'text-white',
  'text-blue-400': 'text-white',
  'text-blue-300': 'text-[#ededed]',
  'text-white': 'text-[#ededed]',
  
  'bg-blue-900/30': 'bg-[#1a1a1a] text-[#ededed]',
  'bg-blue-900/50': 'bg-[#222] text-[#ededed]',
  
  'text-xs': 'text-[13px]',
};

for (const [pattern, dark] of Object.entries(replacements)) {
  code = code.replace(new RegExp(`\\b${pattern}\\b`, 'g'), dark);
}

fs.writeFileSync('src/App.tsx', code);
console.log('done');
