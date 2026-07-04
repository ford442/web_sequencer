const regex3 = /source\.connect\(filter\);\s*if \(finalShaperDest\) \{\s*filter\.connect\(finalShaperDest\);\s*finalShaperDest\.connect\(gain\);\s*\} else \{\s*filter\.connect\(gain\);\s*\}\s*if \(wetGain\) \{\s*gain\.connect\(spectralFinalDest\);\s*gain\.connect\(wetGain\);\s*\} else \{\s*gain\.connect\(spectralFinalDest\);\s*\}/;

console.log("Legacy Regex 3:");
console.log(regex3);
