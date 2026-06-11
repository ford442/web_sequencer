import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# Fix expressiveNode types
content = content.replace("expressiveNode.connect(finalDestination);", "if (expressiveNode) { expressiveNode.connect(finalDestination); }")
content = content.replace("finalDestination = expressiveNode;", "if (expressiveNode) { finalDestination = expressiveNode as unknown as AudioNode; }")

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
