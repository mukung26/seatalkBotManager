const fs = require('fs');

const updateLogic = (file) => {
  let content = fs.readFileSync(file, 'utf8');
  
  // App.tsx
  if (file.includes('App.tsx')) {
    content = content.replace(
      /f\.properties\.place && f\.properties\.place\.toLowerCase\(\)\.includes\("mindanao"\)/g,
      'f.properties.place && f.properties.place.toLowerCase().includes("philippines") && f.geometry.coordinates[1] >= 5.0 && f.geometry.coordinates[1] <= 10.5 && f.geometry.coordinates[0] >= 121.5 && f.geometry.coordinates[0] <= 127.0'
    );
  }
  
  // server.ts & cloudflare-worker.js
  if (file.includes('server.ts') || file.includes('cloudflare-worker.js')) {
    content = content.replace(
      /f\.properties\.place \&\& f\.properties\.place\.toLowerCase\(\)\.includes\("mindanao"\)/g,
      'f.properties.place && f.properties.place.toLowerCase().includes("philippines") && f.geometry && f.geometry.coordinates && f.geometry.coordinates[1] >= 5.0 && f.geometry.coordinates[1] <= 10.5 && f.geometry.coordinates[0] >= 121.5 && f.geometry.coordinates[0] <= 127.0'
    );
  }
  
  fs.writeFileSync(file, content);
};

updateLogic('src/App.tsx');
updateLogic('server.ts');
updateLogic('cloudflare-worker.js');
