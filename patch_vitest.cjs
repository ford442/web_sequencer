const fs = require('fs');
const path = 'vitest.setup.unit.ts';
let code = fs.readFileSync(path, 'utf8');
code = code.replace(
  'const suiteMatchers: FetchMatcher[] = [];',
  'const suiteMatchers: FetchMatcher[] = [/\\.wasm\\?init$/];'
);
code = code.replace(
  'suiteMatchers.length = 0;',
  'suiteMatchers.length = 0;\n  suiteMatchers.push(/\\.wasm\\?init$/);'
);
fs.writeFileSync(path, code);
