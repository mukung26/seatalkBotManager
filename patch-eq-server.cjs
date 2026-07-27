const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const eqFuncCode = `
async function checkEarthquakesLocal() {
  try {
    const eqSet = db.prepare("SELECT value FROM settings WHERE key = 'earthquake_alerts'").get() as any;
    if (!eqSet || !eqSet.value) return;
    const eqConfig = JSON.parse(eqSet.value);
    if (!eqConfig.enabled || !eqConfig.target_type || !eqConfig.target_value) return;
    
    const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson");
    if (!res.ok) return;
    const data = await res.json();
    const phEarthquakes = data.features.filter((f: any) => f.properties.place && f.properties.place.toLowerCase().includes("philippines"));
    
    if (phEarthquakes.length === 0) return;
    
    const lastEqSet = db.prepare("SELECT value FROM settings WHERE key = 'last_earthquake_time'").get() as any;
    let lastEqTime = 0;
    if (lastEqSet) {
      lastEqTime = parseInt(lastEqSet.value, 10);
    } else {
      lastEqTime = Date.now();
      db.prepare("INSERT INTO settings (key, value) VALUES ('last_earthquake_time', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(lastEqTime));
      return;
    }
    
    let maxTime = lastEqTime;
    for (const eq of phEarthquakes) {
      const eqTime = eq.properties.time;
      if (eqTime > lastEqTime) {
        if (eqTime > maxTime) maxTime = eqTime;
        const msgText = \`🚨 **EARTHQUAKE ALERT (Philippines)** 🚨\\n\\n**Magnitude:** \${eq.properties.mag}\\n**Location:** \${eq.properties.place}\\n**Time:** \${new Date(eqTime).toLocaleString("en-US", { timeZone: "Asia/Manila" })}\\n\\n**Details:** \${eq.properties.url}\`;
        
        try {
          if (eqConfig.target_type === "private") {
            await sendPrivateMessageLocal(eqConfig.target_value, msgText);
          } else {
            await sendGroupMessageLocal(eqConfig.target_value, msgText);
          }
          console.log(\`[Scheduler] Dispatched Earthquake alert for \${eq.properties.title}\`);
        } catch (e) {
          console.error(\`[Scheduler] Failed to dispatch Earthquake alert:\`, e);
        }
      }
    }
    
    if (maxTime > lastEqTime) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('last_earthquake_time', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(maxTime));
    }
  } catch (e) {
    console.error("Error in checkEarthquakesLocal:", e);
  }
}
`;

content = content.replace('setInterval(runScheduledBroadcastsLocal, 10000);', 'setInterval(runScheduledBroadcastsLocal, 10000);\nsetInterval(checkEarthquakesLocal, 60000);\n' + eqFuncCode);

fs.writeFileSync('server.ts', content);
