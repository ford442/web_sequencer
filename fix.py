with open('src/components/MainSequencer.tsx', 'r') as f:
    content = f.read()

content = content.replace("""    return (
        <g transform={`translate(0, ${rowIndex * 60})`}>
        return (
        <g className="track-label" onClick={() => onSelectRow(rowKey)} cursor="pointer" role="button" tabIndex={0} aria-label={`Select ${label} track`} aria-pressed={isSelected} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectRow(rowKey); } }}>""",
"""    return (
        <g transform={`translate(0, ${rowIndex * 60})`}>
            <g className="track-label" onClick={() => onSelectRow(rowKey)} cursor="pointer" role="button" tabIndex={0} aria-label={`Select ${label} track`} aria-pressed={isSelected} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectRow(rowKey); } }}>""")

content = content.replace("""                {/* TB-303 silver/chrome hint line */}
                {rowKey === 'bass2' && (
                    <line x1={-65} y1={36} x2={-20} y2={36} stroke={isSelected ? '#ff0066' : '#4b5563'} strokeWidth={1} opacity={isSelected ? 0.5 : 0.3} />
                )}
            </g>
        return (
        <g transform="translate(30, 16)">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(slot => (<TrackSlotButton key={slot} index={slot} isActive={activeSlot === slot} hasData={!!trackSlots[slot]} trackKey={rowKey} onSelect={onSelectSlot} />))}
            </g>
        return (
        <g transform={`translate(220, 0) scale(${zoom}, 1) translate(-220, 0)`}>
                <GridIndicators />
                {renderedSteps}
            </g>
        </g>
    )""",
"""                {/* TB-303 silver/chrome hint line */}
                {rowKey === 'bass2' && (
                    <line x1={-65} y1={36} x2={-20} y2={36} stroke={isSelected ? '#ff0066' : '#4b5563'} strokeWidth={1} opacity={isSelected ? 0.5 : 0.3} />
                )}
            </g>
            <g transform="translate(30, 16)">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(slot => (<TrackSlotButton key={slot} index={slot} isActive={activeSlot === slot} hasData={!!trackSlots[slot]} trackKey={rowKey} onSelect={onSelectSlot} />))}
            </g>
            <g transform={`translate(220, 0) scale(${zoom}, 1) translate(-220, 0)`}>
                <GridIndicators />
                {renderedSteps}
            </g>
        </g>
    )""")

with open('src/components/MainSequencer.tsx', 'w') as f:
    f.write(content)
