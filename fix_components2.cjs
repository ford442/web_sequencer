const fs = require('fs');
let content = fs.readFileSync('src/components/rbs-import-modal/ImportOptionsPanel.tsx', 'utf8');
content = content.replace(
  "{isExpanded ? '▼' : '▶'} <span className=\"ml-1\">Advanced Options</span>",
  "{isExpanded ? <span aria-hidden=\"true\">▼</span> : <span aria-hidden=\"true\">▶</span>} <span className=\"ml-1\">Advanced Options</span>"
);
fs.writeFileSync('src/components/rbs-import-modal/ImportOptionsPanel.tsx', content, 'utf8');
