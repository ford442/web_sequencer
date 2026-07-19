import fs from 'fs';

let content = fs.readFileSync('src/components/appParts/RackNode.tsx', 'utf8');

content = content.replace(
  /const activeLane = matching\.find\(\n\s*\(l\) =>\n\s*l\.enabled && \(l\.scope === "song" \|\| l\.patternIndex === patternIndex\),\n\s*\);/g,
  `let activeLane: UnifiedAutomationLane | undefined;
    for (let i = 0; i < matching.length; i++) {
      const l = matching[i];
      if (l.enabled && (l.scope === "song" || l.patternIndex === patternIndex)) {
        activeLane = l;
        break;
      }
    }`
);

fs.writeFileSync('src/components/appParts/RackNode.tsx', content, 'utf8');
