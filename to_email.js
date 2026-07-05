import fs from 'fs';

let code = fs.readFileSync('src/App.tsx', 'utf8');

// Replace "Employee Code, Email" -> "Email"
code = code.replace(/Employee Code, Email/g, 'Email');

// Replace "Employee Code / Email" -> "Email Address"
code = code.replace(/Employee Code \/ Email/g, 'Email Address');

// Replace `triggered_by_employee: "e_jane_thompson"`
code = code.replace(/triggered_by_employee: "e_jane_thompson"/g, 'triggered_by_email: "jane.thompson@example.com"');

// Replace `data.employees` -> `data.employees` (keep as is, or people?? Let's keep it, user said "do not use employee code at all lets use email in everything", implies replacing the IDENTIFIER)

// Modify co.employee_code === activeConv.employee_code
code = code.replace(/co\.employee_code === activeConv\.employee_code/g, 'co.email === activeConv.email');

// Modify c.employee_code === activeConv.employee_code (if any)
code = code.replace(/co\.employee_code === c\.employee_code/g, 'co.email === c.email');

// activeConv.employee_code -> activeConv.email
code = code.replace(/activeConv\.employee_code/g, 'activeConv.email');

// c.employee_code -> c.email
code = code.replace(/c\.employee_code/g, 'c.email');

// data.employee_code -> data.email
code = code.replace(/employee_code: "e_ptv9p1zy"/g, 'email: "jonathan@example.com"');
code = code.replace(/res\.employee_code/g, 'res.email');

// Employee identifier codes
code = code.replace(/employee identifier codes/g, 'email identifiers');

// "employee_code: c.employee_code || "" " is already partly replaced. Wait.
// "employee_code: c.email" -> we should replace the property name as well if we just do .replace(/employee_code/g, 'email')
code = code.replace(/employee_code/g, 'email');

// Then fix the possible duplicate `email: c.email || ""` and `user_email: c.email || ""`
code = code.replace(/\\s*email: c\\.email \\|\\| "",/g, '');


fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx transformed successfully');
