1.  **Modify `src/hooks/appState/useLyricHandlers.ts`:**
    *   Import `ScaleDefinition`.
    *   Update `useLyricHandlers` arguments to accept `setCurrentScale: (scale: ScaleDefinition | null) => void;`.
    *   In `handleLyricApply`, calculate the text sentiment similar to `handleTextToDrums`.
    *   Map the sentiment to a scale. If the text is heavily positive (`normalizedSentiment > 0.3`), use 'Lydian' or 'Major'. If neutral, leave alone or set to 'Major'. If negative (`normalizedSentiment < -0.3`), use 'Minor' or 'Phrygian'. Set this scale using `setCurrentScale`.
2.  **Modify `src/hooks/useAppState.tsx`:**
    *   Pass `setCurrentScale` to `useLyricHandlers`.
3.  **Run formatting and tests:**
    *   `pnpm lint` and `pnpm test`.
4.  **Complete pre-commit steps:**
    *   `pre_commit_instructions` tool to run verification.
    *   Update `agent_plan.md` to check off the task and add a new one from the Innovation Lab.
5.  **Submit PR:**
    *   Commit changes and submit.
