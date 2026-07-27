const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Add state variables
const stateVars = `
  const [eqEnabled, setEqEnabled] = useState("disabled");
  const [eqTargetType, setEqTargetType] = useState("group");
  const [eqTargetId, setEqTargetId] = useState("");
  const [savingEq, setSavingEq] = useState(false);
`;
content = content.replace('  const [hasToken, setHasToken] = useState(false);', '  const [hasToken, setHasToken] = useState(false);\n' + stateVars);

// Load settings
const loadSettingsCode = `
        const eqSettings = data.earthquake_alerts || {};
        setEqEnabled(eqSettings.enabled ? "enabled" : "disabled");
        setEqTargetType(eqSettings.target_type || "group");
        setEqTargetId(eqSettings.target_value || "");
`;
content = content.replace('setAppScriptUrl(sheetSettings.app_script_url || "");', 'setAppScriptUrl(sheetSettings.app_script_url || "");\n' + loadSettingsCode);

// Save function
const saveEqCode = `
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
content = content.replace('  return (', saveEqCode + '\n  return (');

// Add the UI Card
const uiCardCode = `
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-red-500">🌋</span>
              Philippine Earthquake Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#888888]">
            <p>
              Automatically monitor the USGS Earthquake API for earthquakes in the Philippines.
              If a new earthquake (&gt;4.5 magnitude) is detected, the bot will send an immediate alert.
            </p>
            <div className="space-y-4 pt-2">
              <div className="bg-[#222]/50 p-4 rounded-lg space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#a1a1aa] uppercase">Status</label>
                    <Select value={eqEnabled} onValueChange={setEqEnabled}>
                      <SelectTrigger className="bg-[#111] border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="enabled">Enabled</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#a1a1aa] uppercase">Target Type</label>
                    <Select value={eqTargetType} onValueChange={setEqTargetType}>
                      <SelectTrigger className="bg-[#111] border-input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="group">Group Chat</SelectItem>
                        <SelectItem value="private">Private Message</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#a1a1aa] uppercase">Target ID (Group or Employee Code)</label>
                    <Input
                      placeholder="e.g. NjIz..."
                      value={eqTargetId}
                      onChange={(e) => setEqTargetId(e.target.value)}
                      className="bg-[#111]"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button size="sm" onClick={saveEarthquakeSettings} disabled={savingEq}>
                    {savingEq ? "Saving..." : "Save Earthquake Settings"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
`;
content = content.replace('<Card className="mb-6">', uiCardCode + '\n        <Card className="mb-6">');

fs.writeFileSync('src/App.tsx', content);
