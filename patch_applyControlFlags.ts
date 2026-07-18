import fs from 'fs';

let content = fs.readFileSync('src/components/appParts/RackNode.tsx', 'utf8');

content = content.replace(
  /const armed = recordArms\.some\(\n\s*\(a\) => a\.target === target && a\.parameter === c\.id && a\.armed,\n\s*\);/g,
  `let armed = false;
    for (let i = 0; i < recordArms.length; i++) {
      const a = recordArms[i];
      if (a.target === target && a.parameter === c.id && a.armed) {
        armed = true;
        break;
      }
    }`
);

fs.writeFileSync('src/components/appParts/RackNode.tsx', content, 'utf8');
