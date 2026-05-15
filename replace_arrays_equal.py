import re

with open('src/components/MainSequencer.tsx', 'r') as f:
    content = f.read()

diff = """<<<<<<< SEARCH
    return (
        prev.rowKey === next.rowKey &&
        prev.label === next.label &&
        prev.rowIndex === next.rowIndex &&
        prev.isSelected === next.isSelected &&
        prev.activeSlot === next.activeSlot &&
        prev.viewMode === next.viewMode &&
        prev.automationParam === next.automationParam &&
        prev.isDrawing === next.isDrawing &&
        prev.zoom === next.zoom &&
        prev.selectionRange?.start === next.selectionRange?.start &&
        prev.selectionRange?.end === next.selectionRange?.end &&
        prev.steps === next.steps &&
        prev.automation === next.automation &&
        prev.trackSlots === next.trackSlots &&
        prev.alignment === next.alignment
    );
});
=======
    const arraysEqual = (a?: any[], b?: any[]) => {
        if (a === b) return true;
        if (!a || !b) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; ++i) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    };
    const automationEqual = (a?: any, b?: any) => {
        if (a === b) return true;
        if (!a || !b) return false;
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const key of keysA) {
            if (!arraysEqual(a[key], b[key])) return false;
        }
        return true;
    };

    return (
        prev.rowKey === next.rowKey &&
        prev.label === next.label &&
        prev.rowIndex === next.rowIndex &&
        prev.isSelected === next.isSelected &&
        prev.activeSlot === next.activeSlot &&
        prev.viewMode === next.viewMode &&
        prev.automationParam === next.automationParam &&
        prev.isDrawing === next.isDrawing &&
        prev.zoom === next.zoom &&
        prev.selectionRange?.start === next.selectionRange?.start &&
        prev.selectionRange?.end === next.selectionRange?.end &&
        arraysEqual(prev.steps, next.steps) &&
        automationEqual(prev.automation, next.automation) &&
        arraysEqual(prev.trackSlots, next.trackSlots) &&
        prev.alignment === next.alignment
    );
});
>>>>>>> REPLACE"""

with open('replace.txt', 'w') as f:
    f.write(diff)
