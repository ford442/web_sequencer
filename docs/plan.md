1. Add `updateAlignment: (bankIndex: number, alignment: AlignmentResult) => void;` to `AudioEngine` interface in `src/types.ts`.
2. Implement `updateAlignment` in `src/hooks/audioEngine/sampleManagement.ts` and return it.
3. Expose `updateAlignment` from `src/hooks/useAudioEngine.ts`.
4. Modify `WaveformDisplayProps` in `src/components/WaveformDisplay.tsx` to include `onAlignmentChange?: (alignment: AlignmentResult) => void`.
5. In `WaveformDisplay.tsx`, add mouse event handlers (down, move, up/leave) to allow dragging markers.
   - Also allow double-click to add or remove a marker.
   - Update `canvas` styles and event bindings.
   - When modified, construct a new `AlignmentResult` and call `onAlignmentChange`.
6. Update `SamplerPanel.tsx` to pass `onAlignmentChange={(alignment) => audioEngine?.updateAlignment?.(activeBankIdx, alignment)}` to `WaveformDisplay`.
7. Also update `agent_plan.md` to check off the "Custom Sample Slicing UI" task and log the progress, and pick a new task if necessary or just add notes.
