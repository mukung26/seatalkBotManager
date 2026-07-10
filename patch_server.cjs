const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const resolveFunc = `
async function resolveEmployeeCode(targetId: string) {
  if (!targetId.includes("@")) {
    return targetId;
  }
  const token = await getAccessToken();
  const res = await fetch(\`\${SEATALK_API}/contacts/v2/get_employee_code_with_email\`, {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${token}\`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ emails: [targetId] })
  });
  if (res.ok) {
    const data = await res.json() as any;
    if (data.code === 0 && data.employees && data.employees.length > 0) {
      const emp = data.employees.find((e: any) => e.code === 0 && e.employee_status === 2) || 
                  data.employees.find((e: any) => e.code === 0 && e.employee_code);
      if (emp && emp.employee_code) {
        return emp.employee_code;
      }
    }
  }
  return targetId;
}
`;

if (!code.includes('async function resolveEmployeeCode')) {
  code = code.replace('async function sendPrivateMessage', resolveFunc + '\nasync function sendPrivateMessage');
}

code = code.replace(
`    if (chat_type === "private") {
      await sendPrivateMessage(target_id, content, message_obj);`,
`    let actualEmployeeCode = target_id;
    if (chat_type === "private") {
      actualEmployeeCode = await resolveEmployeeCode(target_id);
      await sendPrivateMessage(actualEmployeeCode, content, message_obj);`
);

fs.writeFileSync('server.ts', code);
console.log("Patched server.ts successfully");
