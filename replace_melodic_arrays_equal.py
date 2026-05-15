import re

with open('src/components/MelodicSequencerRow.tsx', 'r') as f:
    content = f.read()

diff = """<<<<<<< SEARCH
    return (
        prev.rowKey === next.rowKey &&
        prev.label === next.label &&
        prev.rowIndex === next.rowIndex &&
        prev.isSelected === next.isSelected &&
        prev.activeSlot === next.activeSlot &&
        prev.zoom === next.zoom &&
        prev.steps === next.steps &&
        prev.trackSlots === next.trackSlots
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

    return (
        prev.rowKey === next.rowKey &&
        prev.label === next.label &&
        prev.rowIndex === next.rowIndex &&
        prev.isSelected === next.isSelected &&
        prev.activeSlot === next.activeSlot &&
        prev.zoom === next.zoom &&
        arraysEqual(prev.steps, next.steps) &&
        arraysEqual(prev.trackSlots, next.trackSlots)
    );
});
>>>>>>> REPLACE"""

with open('replace.txt', 'w') as f:
    f.write(diff)
