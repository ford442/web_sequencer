## 2026-09-14 - Trap focus in LoadingOverlay
**Learning:** The `LoadingOverlay` is a critical full-screen modal during initial load, but it lacked focus trapping, allowing keyboard navigation to access elements underneath it. Applying `useFocusTrap` to untrapped dialogs like `LoadingOverlay` is crucial for maintaining an accessible and expected modal experience.
**Action:** Always ensure full-screen overlays with `role="dialog"` and `aria-modal="true"` implement `useFocusTrap` to prevent keyboard users from tabbing outside the modal content.

## 2026-09-17 - Add useFocusTrap to untrapped dialogs
**Learning:** Several modal dialogs in the application (`ExportModal`, `RbsImportModal`, `PhonemePainter`, `AISongImportOverlay`, `CrashRecoveryPrompt`, and `PerformanceMode`) were missing the `useFocusTrap` hook. This allowed keyboard users to accidentally tab out of the dialog and interact with the background application, which violates accessibility guidelines for modal windows.
**Action:** Implemented `useFocusTrap` on all identified dialogs that were missing it. It is essential to ensure that any component that acts as a modal overlay (e.g., using `role="dialog"` or `role="alertdialog"`) correctly traps focus so that keyboard navigation remains within the modal until it is closed.
## YYYY-MM-DD - Accessible Decorative Icons in Buttons
**Learning:** When using decorative text characters (like `✕` for close buttons) instead of SVGs inside a `<button>`, screen readers will read the character's literal name (e.g., "multiplication x") alongside the button's `aria-label`, creating confusing double-announcements.
**Action:** Always wrap decorative text characters in a `<span aria-hidden="true">` element inside buttons to ensure screen readers only announce the intended `aria-label`. Additionally, always pair `aria-label` with `title` to provide a visual tooltip for sighted users.

## 2026-09-17 - Accessible Decorative Emojis
**Learning:** Decorative emojis (like ⚠️, ⏳, 🎮, 🎵, etc.) that are used alongside text labels will be read aloud by screen readers, leading to confusing double-announcements or unexpected symbols being vocalized (e.g., "hourglass with flowing sand Validating..."). This issue is not limited to buttons but applies to any text container where emojis are used purely for visual enhancement.
**Action:** Always wrap purely decorative emojis in a `<span aria-hidden="true">` element to ensure screen readers skip them and only announce the intended text.
## 2026-09-17 - Remove redundant aria-live from static empty states
**Learning:** Found several statically rendered empty states throughout the application using `border-dashed` that correctly utilized `role="status"` but unnecessarily appended `aria-live="polite"`. According to W3C specifications, `role="status"` implicitly provides `aria-live="polite"`. Including both can cause some screen readers to double-announce the state on mount.
**Action:** When implementing static empty states, specify `role="status"` but omit `aria-live="polite"`. Reserve the explicit `aria-live` attribute solely for regions that dynamically inject text during interaction, or use the `A11yAnnouncer` for those dynamic cases.
