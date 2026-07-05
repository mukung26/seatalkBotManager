import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Replace classes
const replacements = {
  'bg-white': 'bg-[#141414]',
  'bg-neutral-50': 'bg-[#0d0d0d]',
  'bg-neutral-100': 'bg-[#1a1a1a]',
  'bg-neutral-200': 'bg-neutral-800',
  'border-neutral-100': 'border-neutral-800', // combined
  'border-neutral-200': 'border-neutral-800',
  'border-neutral-300': 'border-neutral-700',
  'text-neutral-900': 'text-neutral-100',
  'text-neutral-800': 'text-neutral-200',
  'text-neutral-700': 'text-neutral-300',
  'text-neutral-600': 'text-neutral-400',
  'text-neutral-500': 'text-neutral-500',
  'text-blue-600': 'text-blue-400',
  'text-blue-700': 'text-blue-300',
  'bg-blue-50': 'bg-blue-900/30',
  'bg-blue-100': 'bg-blue-900/50',
  'border-blue-100': 'border-blue-800',
  'border-blue-200': 'border-blue-800',
  'text-emerald-600': 'text-emerald-400',
  'bg-emerald-50': 'bg-emerald-900/30',
  'border-emerald-200': 'border-emerald-800',
  'text-amber-600': 'text-amber-400',
  'bg-amber-50': 'bg-amber-900/30',
  'border-amber-200': 'border-amber-800',
  'text-rose-600': 'text-rose-400',
  'bg-rose-50': 'bg-rose-900/30',
  'border-rose-200': 'border-rose-800',
  'text-red-600': 'text-red-400',
  'text-red-500': 'text-red-400',
  'bg-red-50': 'bg-red-900/30',
  'bg-red-100': 'bg-red-900/50',
  'border-red-100': 'border-red-900',
  'border-red-200': 'border-red-800',
  'shadow-sm': 'shadow-none',
  'shadow-md': 'shadow-none',
  'shadow-lg': 'shadow-none'
};

for (const [light, dark] of Object.entries(replacements)) {
  code = code.replace(new RegExp(`\\b${light}\\b`, 'g'), dark);
}

fs.writeFileSync('src/App.tsx', code);
console.log('done');
