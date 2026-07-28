const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Add testingEq state
content = content.replace('  const [savingEq, setSavingEq] = useState(false);', '  const [savingEq, setSavingEq] = useState(false);\n  const [testingEq, setTestingEq] = useState(false);');

// Add testEarthquakeAlert function
const funcCode = `
  const testEarthquakeAlert = async () => {
    if (!eqTargetId) {
      toast.error("Please specify a Target ID first");
      return;
    }
    setTestingEq(true);
    try {
      await api.sendMessage({
        chat_type: eqTargetType,
        target_id: eqTargetId,
        content: "🚨 **TEST EARTHQUAKE ALERT** 🚨\\n\\nThis is a test ping to verify the Earthquake Alert system is working correctly.\\n\\nTarget: " + eqTargetId
      });
      toast.success("Test alert sent successfully!");
    } catch (e) {
      toast.error("Failed to send test alert");
    } finally {
      setTestingEq(false);
    }
  };
`;

content = content.replace('  const saveEarthquakeSettings = async () => {', funcCode + '\n  const saveEarthquakeSettings = async () => {');

// Replace UI buttons using string replace on a smaller snippet
const oldButtonHtml = '<div className="flex justify-end pt-2">';
const newButtonHtml = `<div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={testEarthquakeAlert} disabled={testingEq || !eqTargetId} className="border-blue-800 hover:bg-blue-900/30">
                    {testingEq ? "Testing..." : "Test Ping"}
                  </Button>`;
                  
content = content.replace(oldButtonHtml, newButtonHtml);

fs.writeFileSync('src/App.tsx', content);
