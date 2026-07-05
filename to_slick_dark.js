import fs from 'fs';

let code = fs.readFileSync('src/App.tsx', 'utf8');

const replacements = {
  // Backgrounds
  'bg-\\[#0d0d0d\\]': 'bg-[#000000]',
  'bg-\\[#141414\\]': 'bg-[#0a0a0a]',
  'bg-\\[#1a1a1a\\]': 'bg-[#141414]',
  'bg-neutral-900': 'bg-[#0a0a0a]',
  'bg-white': 'bg-black',
  'bg-neutral-100': 'bg-[#111111]',

  // Borders
  'border-neutral-800': 'border-[#222222]',
  'border-neutral-700': 'border-[#333333]',
  'border-neutral-200': 'border-[#222222]',
  
  // Text
  'text-neutral-100': 'text-white',
  'text-neutral-200': 'text-[#ececec]',
  'text-neutral-300': 'text-[#a1a1aa]',
  'text-neutral-400': 'text-[#888888]',
  'text-neutral-500': 'text-[#666666]',
  'text-neutral-900': 'text-[#ededed]',
  'text-white': 'text-[#ededed]',

  // Accents (Blue to a sleek White/Zinc)
  'bg-blue-600': 'bg-white',
  'text-blue-600': 'text-black',
  'bg-blue-50': 'bg-[#111111]',
  'hover:bg-blue-50/50': 'hover:bg-[#111111]',
  'bg-blue-900/30': 'bg-[#1a1a1a] text-white',
  'bg-blue-900/50': 'bg-[#222222] text-white',
  'text-blue-300': 'text-white',
  'text-blue-400': 'text-white',
  'text-blue-500': 'text-[#a1a1aa] hover:text-white',
  'border-blue-200': 'border-[#333333]',
  
  // Shadows
  'shadow-xl': 'shadow-[0_0_40px_rgba(0,0,0,0.5)]',
  'shadow-none': 'shadow-sm',

  // Other minor
  'bg-transparent': 'bg-transparent',
  'ring-blue-600': 'ring-white',
};

// Also apply font-sans across the board if not fully utilizing geist
for (const [pattern, dark] of Object.entries(replacements)) {
  code = code.replace(new RegExp(`\\b${pattern}\\b`, 'g'), dark);
}

// Add a glowing effect to the sidebar logo
code = code.replace(
  '<div className="bg-white p-1.5 rounded-lg text-black">', 
  '<div className="bg-white p-1.5 rounded-lg text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]">'
);

// We change font-bold text-lg to font-semibold
code = code.replace(
  'font-bold text-lg text-white',
  'font-medium text-lg text-white'
);

fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx transformed successfully');
