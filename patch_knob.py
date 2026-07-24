import re

with open('src/hooks/useKnobInteraction.ts', 'r') as f:
    content = f.read()

# Let's add a console log inside useKnobInteraction's emitChange to see if it moves.
search_str = """    const emitChange = useCallback((next: number) => {
        dragLiveValueRef.current = next;"""

replace_str = """    const emitChange = useCallback((next: number) => {
        // console.log("emitChange", next);
        dragLiveValueRef.current = next;"""

content = content.replace(search_str, replace_str)

with open('src/hooks/useKnobInteraction.ts', 'w') as f:
    f.write(content)
