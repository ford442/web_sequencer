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
        "aria-label={isPlaying ? \"Stop Playback (Space)\" : \"Start Playback (Space)\"} className={`h-8 px-5 font-orbitron text-sm font-bold"
    ]
]);
