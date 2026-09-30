const fs = require('fs');

function applyRegexes(filePath, replacements) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    for (let i = 0; i < replacements.length; i++) {
        content = content.replace(replacements[i][0], replacements[i][1]);
    }
    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${filePath}`);
    } else {
        console.log(`No changes made to ${filePath}`);
    }
}

applyRegexes('src/components/TransportToolbar.tsx', [
    [
        /\{isPlaying \? '■ STOP' : \(playLabel \?\? '▶ PLAY'\)\}/g,
        "{isPlaying ? <><span aria-hidden=\"true\">■</span> STOP</> : (playLabel ?? <><span aria-hidden=\"true\">▶</span> PLAY</>)}"
    ],
    [
        /\{slaveMode \? '◎ ARM' : '■ STOP'\}/g,
        "{slaveMode ? <><span aria-hidden=\"true\">◎</span> ARM</> : <><span aria-hidden=\"true\">■</span> STOP</>}"
    ],
    [
        /className=\{\`h-8 px-5 font-orbitron text-sm font-bold/g,
        "aria-label={isPlaying ? \"Stop Playback\" : \"Start Playback\"} className={`h-8 px-5 font-orbitron text-sm font-bold"
    ]
]);

applyRegexes('src/components/rbs-import-modal/ImportOptionsPanel.tsx', [
    [
        /\{isExpanded \? '▼' : '▶'\} <span className="ml-1">Advanced Options<\/span>/g,
        "{isExpanded ? <span aria-hidden=\"true\">▼</span> : <span aria-hidden=\"true\">▶</span>} <span className=\"ml-1\">Advanced Options</span>"
    ]
]);
