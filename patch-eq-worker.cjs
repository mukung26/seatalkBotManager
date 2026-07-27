const fs = require('fs');
let content = fs.readFileSync('cloudflare-worker.js', 'utf8');

const eqFuncCode = `
async function checkEarthquakes(env) {
  try {
    if (!env.DB) return;
    const { results } = await env.DB.prepare("SELECT value FROM settings WHERE key = 'earthquake_alerts'").all();
    if (!results || results.length === 0) return;
    const eqConfig = JSON.parse(results[0].value);
    if (!eqConfig.enabled || !eqConfig.target_type || !eqConfig.target_value) return;
    
    const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson");
    if (!res.ok) return;
    const data = await res.json();
    const phEarthquakes = data.features.filter((f) => f.properties.place && f.properties.place.toLowerCase().includes("philippines"));
    if (phEarthquakes.length === 0) return;
    
    const { results: lastEqResults } = await env.DB.prepare("SELECT value FROM settings WHERE key = 'last_earthquake_time'").all();
    let lastEqTime = 0;
    if (lastEqResults && lastEqResults.length > 0) {
      lastEqTime = parseInt(lastEqResults[0].value, 10);
    } else {
      lastEqTime = Date.now();
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('last_earthquake_time', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(lastEqTime)).run();
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
            await sendPrivateMessage(env, eqConfig.target_value, msgText);
          } else {
            await sendGroupMessage(env, eqConfig.target_value, msgText);
          }
          await logEvent(env, "info", \`Dispatched Earthquake alert for \${eq.properties.title}\`);
        } catch (e) {
          await logEvent(env, "error", \`Failed Earthquake alert: \${e.toString()}\`);
        }
      }
    }
    
    if (maxTime > lastEqTime) {
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('last_earthquake_time', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(maxTime)).run();
    }
  } catch (e) {
    console.error("Error in checkEarthquakes:", e);
  }
}
`;

content = content.replace('async function runScheduledBroadcasts(env) {', eqFuncCode + '\nasync function runScheduledBroadcasts(env) {');
content = content.replace('ctx.waitUntil(runScheduledBroadcasts(env));', 'ctx.waitUntil(runScheduledBroadcasts(env));\n    ctx.waitUntil(checkEarthquakes(env));');

fs.writeFileSync('cloudflare-worker.js', content);
