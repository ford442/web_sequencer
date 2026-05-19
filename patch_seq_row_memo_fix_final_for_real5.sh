cat << 'INNER_EOF' > /tmp/patch_seq_row_memo_fix_final_for_real5.txt
<<<<<<< SEARCH
        </g>
    )
});

export interface MainSequencerHandle {
=======
        </g>
    )
}));

export interface MainSequencerHandle {
>>>>>>> REPLACE
INNER_EOF
patch -p1 src/components/MainSequencer.tsx < /tmp/patch_seq_row_memo_fix_final_for_real5.txt
