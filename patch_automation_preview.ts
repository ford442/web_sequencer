import fs from 'fs';

let content = fs.readFileSync('src/components/appParts/RackNode.tsx', 'utf8');

// Replace array filtering with mapping
content = content.replace(
  /const matching = lanes\.filter\(\n\s*\(l\) => l\.target === target && l\.parameter === c\.id,\n\s*\);/g,
  `const matching: UnifiedAutomationLane[] = [];
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i];
      if (l.target === target && l.parameter === c.id) {
        matching.push(l);
      }
    }`
);

fs.writeFileSync('src/components/appParts/RackNode.tsx', content, 'utf8');
