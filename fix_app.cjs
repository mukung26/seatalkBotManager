const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const badFuncCode = `
  const saveEarthquakeSettings = async () => {
    setSavingEq(true);
    try {
      await api.saveSetting("earthquake_alerts", {
        enabled: eqEnabled === "enabled",
        target_type: eqTargetType,
        target_value: eqTargetId
      });
      toast.success("Earthquake settings saved!");
    } catch (e) {
      toast.error("Failed to save settings");
    } finally {
      setSavingEq(false);
    }
  };
`;
// Remove from the wrong place
content = content.replace(badFuncCode, '');

// Insert it right before the actual return of SettingsPanel
content = content.replace('  return (\n    <div className="h-full overflow-y-auto p-6 md:p-10 bg-black/50">', badFuncCode + '\n  return (\n    <div className="h-full overflow-y-auto p-6 md:p-10 bg-black/50">');

fs.writeFileSync('src/App.tsx', content);
