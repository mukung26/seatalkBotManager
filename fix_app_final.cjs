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

// It's currently right after handleDeleteRule
content = content.replace(badFuncCode, '');

// The correct place is right before the return of SettingsPanel.
// Let's find SettingsPanel saveSettings
const settingsSaveFunc = `
  const saveSettings = async () => {
    setSaving(true);
    try {
      const existing = await api.getSettings();
      const currentSheet = existing.google_sheets || {};
      const updated = {
        ...currentSheet,
        spreadsheet_id: spreadsheetId,
        app_script_url: appScriptUrl,
      };
      await api.saveSetting("google_sheets", updated);
      toast.success("Settings saved!");
    } catch (e) {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };
`;
content = content.replace(settingsSaveFunc, settingsSaveFunc + '\n' + badFuncCode);

fs.writeFileSync('src/App.tsx', content);
