const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Replace UI text
content = content.replace('Philippine Earthquake Alerts', 'Mindanao Earthquake Alerts');
content = content.replace('earthquakes in the Philippines', 'earthquakes in the Mindanao region');

// Add sendLatestEarthquake function
const funcCode = `
  const sendLatestEarthquake = async () => {
    if (!eqTargetId) {
      toast.error("Please specify a Target ID first");
      return;
    }
    setTestingEq(true);
    try {
      const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson");
      if (!res.ok) throw new Error("Failed to fetch USGS data");
      const data = await res.json();
      const mindanaoEarthquakes = data.features.filter((f: any) => 
        f.properties.place && f.properties.place.toLowerCase().includes("mindanao")
      );
      
      if (mindanaoEarthquakes.length === 0) {
        toast.info("No recent >4.5 earthquakes found for Mindanao.");
        setTestingEq(false);
        return;
      }
      
      const latestEq = mindanaoEarthquakes[0];
      const eqTime = latestEq.properties.time;
      const msgText = \`🚨 **EARTHQUAKE ALERT (Mindanao)** 🚨\\n\\n**Magnitude:** \${latestEq.properties.mag}\\n**Location:** \${latestEq.properties.place}\\n**Time:** \${new Date(eqTime).toLocaleString("en-US", { timeZone: "Asia/Manila" })}\\n\\n**Details:** \${latestEq.properties.url}\`;
      
      await api.sendMessage({
        chat_type: eqTargetType,
        target_id: eqTargetId,
        content: msgText
      });
      toast.success("Latest earthquake alert sent!");
    } catch (e: any) {
      toast.error("Failed to send latest earthquake alert");
    } finally {
      setTestingEq(false);
    }
  };
`;

content = content.replace('  const saveEarthquakeSettings = async () => {', funcCode + '\n  const saveEarthquakeSettings = async () => {');

// Replace buttons
const oldButtonHtml = `<div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={testEarthquakeAlert} disabled={testingEq || !eqTargetId} className="border-blue-800 hover:bg-blue-900/30">
                    {testingEq ? "Testing..." : "Test Ping"}
                  </Button>
                  <Button size="sm" onClick={saveEarthquakeSettings} disabled={savingEq}>
                    {savingEq ? "Saving..." : "Save Earthquake Settings"}
                  </Button>
                </div>`;

const newButtonHtml = `<div className="flex justify-end gap-2 pt-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={testEarthquakeAlert} disabled={testingEq || !eqTargetId} className="border-blue-800 hover:bg-blue-900/30">
                    {testingEq ? "Testing..." : "Test Ping"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={sendLatestEarthquake} disabled={testingEq || !eqTargetId} className="border-amber-700 hover:bg-amber-900/30 text-amber-500">
                    {testingEq ? "Sending..." : "Send Latest Alert"}
                  </Button>
                  <Button size="sm" onClick={saveEarthquakeSettings} disabled={savingEq}>
                    {savingEq ? "Saving..." : "Save Earthquake Settings"}
                  </Button>
                </div>`;

content = content.replace(oldButtonHtml, newButtonHtml);

fs.writeFileSync('src/App.tsx', content);
