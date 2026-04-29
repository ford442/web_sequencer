const fs = require('fs');

const file2 = 'tests/verify_note_length.spec.ts';
let content2 = fs.readFileSync(file2, 'utf8');
content2 = content2.replace("const trackRow = page.locator('.flex-1.relative.min-h-\\\\[40px\\\\]').first();\n    await trackRow.waitFor();", "");
fs.writeFileSync(file2, content2);
