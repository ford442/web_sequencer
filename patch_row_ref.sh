cat << 'INNER_EOF' > /tmp/patch_row_ref.txt
<<<<<<< SEARCH
                            <SequencerRow
                                key={row.key} ref={(el) => { rowRefs.current[rIdx] = el; }} rowKey={row.key} label={row.key === 'sampler' ? \`SMP \${activeSamplerBank + 1}\` : row.label} rowIndex={rIdx}
=======
                            <SequencerRow
                                key={row.key} ref={(el) => { if (rowRefs?.current) rowRefs.current[rIdx] = el; }} rowKey={row.key} label={row.key === 'sampler' ? \`SMP \${activeSamplerBank + 1}\` : row.label} rowIndex={rIdx}
>>>>>>> REPLACE
INNER_EOF
patch -p1 src/components/MainSequencer.tsx < /tmp/patch_row_ref.txt
