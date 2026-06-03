1.  **Refactor `useAppState.tsx` hot paths:**
    -   The file `src/hooks/useAppState.tsx` contains several state updater functions (e.g., `handleNoteLengthChange`, `handleKeyboardPlay`, `handleNoteSelect`, keyboard/mouse event handlers, etc.) that manually clone array parts, particularly `[...copy.sampler]`, `[...copy.sampler[bankIdx].steps]`, `[...copy[trackKey].steps]`.
    -   We will replace these manual inline spread updates with the structurally shared, memo-safe pure helper functions already available at the top of the file: `updateSamplerStep` and `updateTrackStep`.
    -   For ranges (like in `handleNoteLengthChange` and the delete functionality in `handleKeyDown`), we'll either create range updater helpers or adjust the loop to only create one clone using a helper, then mutate the single new object instead of spreading arrays in the component's body.
    -   Specifically, target: `handlePatternChange`, `handleKeyboardPlay`/`handleKeyboardStop` recording loop, `handleKeyDown` deletion loop, `handleNoteLengthChange`, `handleLyricApply` looping, and `handlePhonemeUpdate`.

2.  **Pre-commit checks**: Run `npm run lint` and `npm run test`. Ensure all tests pass.

3.  **Journal the learning**: Write the performance tip regarding pure structural-sharing update helpers vs inline spreading arrays into `.jules/bolt.md`.
