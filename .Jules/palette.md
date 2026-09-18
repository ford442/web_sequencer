## 2026-09-14 - Trap focus in LoadingOverlay
**Learning:** The `LoadingOverlay` is a critical full-screen modal during initial load, but it lacked focus trapping, allowing keyboard navigation to access elements underneath it. Applying `useFocusTrap` to untrapped dialogs like `LoadingOverlay` is crucial for maintaining an accessible and expected modal experience.
**Action:** Always ensure full-screen overlays with `role="dialog"` and `aria-modal="true"` implement `useFocusTrap` to prevent keyboard users from tabbing outside the modal content.

## 2026-09-17 - Add useFocusTrap to untrapped dialogs
**Learning:** Several modal dialogs in the application (`ExportModal`, `RbsImportModal`, `PhonemePainter`, `AISongImportOverlay`, `CrashRecoveryPrompt`, and `PerformanceMode`) were missing the `useFocusTrap` hook. This allowed keyboard users to accidentally tab out of the dialog and interact with the background application, which violates accessibility guidelines for modal windows.
**Action:** Implemented `useFocusTrap` on all identified dialogs that were missing it. It is essential to ensure that any component that acts as a modal overlay (e.g., using `role="dialog"` or `role="alertdialog"`) correctly traps focus so that keyboard navigation remains within the modal until it is closed.
