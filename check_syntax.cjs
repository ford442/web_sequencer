const ts = require('typescript');
const fs = require('fs');

let code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');
let sourceFile = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);

let syntaxDiagnostics = sourceFile.parseDiagnostics;
if (syntaxDiagnostics.length > 0) {
    syntaxDiagnostics.forEach(d => {
        let pos = sourceFile.getLineAndCharacterOfPosition(d.start);
        console.log(`Error at line ${pos.line + 1}: ${d.messageText}`);
    });
} else {
    console.log("No syntax errors found by JS compiler!");
}
