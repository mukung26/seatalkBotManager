const fs = require('fs');
let code = fs.readFileSync('cloudflare-worker.js', 'utf8');

const targetStr = "const profiles = [];\\n          for (let b = 0; b < codesArr.length; b += 50) {\\n             const batch = codesArr.slice(b, b + 50);\\n             const batchProfiles = await Promise.all(\\n               batch.map((c) => getEmployeeProfile(env, c))\\n             );\\n             profiles.push(...batchProfiles);\\n          }\\n          \\n          for (let i = 0; i < codesArr.length; i++) {\\n            const code = codesArr[i];\\n            const p = profiles[i];";

const replacementStr = "const profiles = [];\\n          const maxToFetch = Math.min(codesArr.length, 10);\\n          for (let b = 0; b < maxToFetch; b += 10) {\\n             const batch = codesArr.slice(b, b + 10);\\n             const batchProfiles = await Promise.all(\\n               batch.map((c) => getEmployeeProfile(env, c))\\n             );\\n             profiles.push(...batchProfiles);\\n          }\\n          for (let i = profiles.length; i < codesArr.length; i++) {\\n            profiles.push({ name: codesArr[i], email: \\"\\" });\\n          }\\n          \\n          for (let i = 0; i < codesArr.length; i++) {\\n            const code = codesArr[i];\\n            const p = profiles[i];";

if (code.includes(targetStr)) {
  code = code.replace(targetStr, replacementStr);
  fs.writeFileSync('cloudflare-worker.js', code);
  console.log("Patched contacts endpoint limit");
} else {
  console.log("Could not find contacts loop. Trying loose replacement.");
  code = code.replace("for (let b = 0; b < codesArr.length; b += 50)", "for (let b = 0; b < Math.min(codesArr.length, 5); b += 50)");
  fs.writeFileSync('cloudflare-worker.js', code);
}
