1. **Identify the Issue**: Static empty state components currently use `role="status"` wrappers on their `div` elements. These static empty states shouldn't be live regions at all, since they don't dynamically change without a full re-render (in most cases), and adding `role="status"` just makes them noisy.
The better route is the existing `A11yAnnouncer` store. Calling it when the state changes, such as a library becoming empty or a filter matching nothing, gives a real announcement. That would be a small, targeted change in `CloudLibrary` and perhaps one or two others. Plain `<div>`s with headings are fine everywhere else for static states.

2. **Formulate the Solution**: For static empty states, we simply remove the unnecessary `role="status"`. For dynamic empty states (like search filtering in `CloudLibrary` and `ShortcutsHelp`), we will use the `a11yAnnouncerStore` to announce the change when the empty state is rendered, and remove the static `role="status"`.

3. **Modify PhonemeWaveformDisplay.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 92 in `src/components/phoneme/PhonemeWaveformDisplay.tsx`.
4. **Modify AutomationLaneList.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 153 in `src/components/automation/AutomationLaneList.tsx`.
5. **Modify CurveEditor.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 250 in `src/components/automation/CurveEditor.tsx`.
6. **Modify WaveformDisplay.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 657 in `src/components/WaveformDisplay.tsx`.
7. **Modify GamepadDebugger.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 65 in `src/components/GamepadDebugger.tsx`.
8. **Modify ParameterSummaryPanel.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 19 in `src/components/rbs-import-modal/ParameterSummaryPanel.tsx`.
9. **Modify MidiMapPanel.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 95 in `src/components/MidiMapPanel.tsx`.
10. **Modify PreviewTabPanel.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` and `aria-live="polite"` from the `sr-only` element on line 69 (by deleting the element entirely since the text is rendered below it) in `src/components/ai-song-modal/PreviewTabPanel.tsx`.
11. **Modify TrackStatisticsPanel.tsx**: Use `replace_with_git_merge_diff` to remove the `sr-only` div on lines 15-17 in `src/components/ai-song-modal/TrackStatisticsPanel.tsx`.
12. **Modify AutomationVisualizationPanel.tsx**: Use `replace_with_git_merge_diff` to remove the `sr-only` div on lines 21-23 in `src/components/ai-song-modal/AutomationVisualizationPanel.tsx`.
13. **Modify PhonemePainter.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 581 in `src/components/PhonemePainter.tsx`.
14. **Modify Wam2GenericEditor.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 220 in `src/components/Wam2GenericEditor.tsx`.
15. **Modify VoiceDesignerSurface.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 168 in `src/components/VoiceDesignerSurface.tsx`.
16. **Modify SessionLauncher.tsx**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 178 in `src/components/SessionLauncher.tsx`.

17. **Modify CloudLibrary.tsx (Import)**: Use `replace_with_git_merge_diff` to add an import for `a11yAnnouncerStore` from `../stores/a11yAnnouncerStore` in `src/components/CloudLibrary.tsx`.
18. **Modify CloudLibrary.tsx (Announcer 1)**: Use `replace_with_git_merge_diff` to add a `useEffect` that calls `a11yAnnouncerStore.announce("Library is empty")` when `songs.length === 0` and `!isLoading` in `src/components/CloudLibrary.tsx`.
19. **Modify CloudLibrary.tsx (Announcer 2)**: Use `replace_with_git_merge_diff` to add a `useEffect` that calls `a11yAnnouncerStore.announce("No items match this filter")` when `filteredSongs.length === 0` and `songs.length > 0` and `!isLoading` in `src/components/CloudLibrary.tsx`.
20. **Modify CloudLibrary.tsx (Remove status 1)**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 275 in `src/components/CloudLibrary.tsx`.
21. **Modify CloudLibrary.tsx (Remove status 2)**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 298 in `src/components/CloudLibrary.tsx`.

22. **Modify ShortcutsHelp.tsx (Import)**: Use `replace_with_git_merge_diff` to add an import for `a11yAnnouncerStore` from `../stores/a11yAnnouncerStore` in `src/components/ShortcutsHelp.tsx`.
23. **Modify ShortcutsHelp.tsx (Announcer)**: Use `replace_with_git_merge_diff` to add a `useEffect` that calls `a11yAnnouncerStore.announce("No topics found")` when `results.length === 0` and `query` is not empty in `src/components/ShortcutsHelp.tsx`.
24. **Modify ShortcutsHelp.tsx (Remove status)**: Use `replace_with_git_merge_diff` to remove `role="status"` from line 248 in `src/components/ShortcutsHelp.tsx`.

25. **Modify PhonemeWaveformDisplay.test.tsx**: Use `replace_with_git_merge_diff` to update `src/components/phoneme/__tests__/PhonemeWaveformDisplay.test.tsx`. We will completely remove the test `should place role="status" on the inner wrapper to avoid announcing interactive elements` since it no longer applies.

26. **Verify changes**: Use `run_in_bash_session` to check files with `cat` and `grep` for `role="status"` to ensure all intended fixes have been applied.

27. **Run tests and linter**: Use `run_in_bash_session` to execute `pnpm lint && pnpm test` to verify nothing was broken.

28. **Pre-commit**: Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

29. **Submit PR**: Use `run_in_bash_session` to execute `gh pr create` with title `🎨 Palette: Improve accessibility of empty states using A11yAnnouncer`.
