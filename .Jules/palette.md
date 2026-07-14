## 2026-07-10 - Precise Accessibility Targeting
**Learning:** Broad regex replacements across JSX codebases to enforce accessibility properties (like `type="button"`) often cause immediate React syntax errors due to duplicated attributes across multi-line tags.
**Action:** Instead of cross-file regex scripts, use specific linter configurations (e.g., `eslint-plugin-react` rules) to find exact violations, and scope fixes to one or two high-impact components per PR to ensure stability and correctness.
## 2024-05-01 - Fix aria-controls for Harmonizer Popover
**Learning:** Found that custom dropdowns/popovers acting as modals or flyouts require a clear structural link using `aria-controls` pointing to the exact `id` of the popover content. The `aria-expanded` and `aria-haspopup` tags alone are insufficient for complete screen reader accessibility if the container it targets cannot be identified via an `id` reference.
**Action:** Always ensure that `aria-controls` matches a specific `id` attribute on the container component whenever implementing custom popup interfaces.
## 2024-06-25 - Advanced Keyboard Interaction Patterns
**Learning:** For a complex app like a DAW, simple gestural controls (like dragging up/down to change pitch) are entirely inaccessible to keyboard-only users. Furthermore, when closing deep nested menus like popovers, relying on the browser's default focus management will drop the user back at the top of the page, ruining the navigation flow.
**Action:** Always provide explicit arrow-key support (`onKeyDown`) for gestural or slider-like UI elements to replicate drag behavior. Always use a `useRef` to track the trigger element that opened a popover, and explicitly call `.focus()` on it when the popover closes.

## 2024-05-09 - Accessibility in Canvas Overlays
**Learning:** Interactive elements within dense, absolute-positioned canvas overlays (like `HarmonizerPopover`) frequently lack focus rings because they aren't part of standard top-to-bottom form flows. Developers often style them as custom widgets but forget keyboard-only navigation needs visible focus states just as much as standard HTML forms do.
**Action:** Always check custom popovers, context menus, and floating widgets for `focus-visible:ring-2` to ensure keyboard accessibility.

## 2024-11-20 - Custom Dialog Focus Management
**Learning:** When implementing custom modals or dialogs using `role="dialog"`, it is critical to include `tabIndex={-1}` on the dialog container itself. Without this, the dialog cannot receive programmatic focus when opened, which can disrupt screen reader announcements and keyboard navigation flow. Additionally, close buttons inside these modals often miss focus rings because they use absolute positioning and custom SVG icons instead of standard button styles.
**Action:** Always verify that custom dialog containers have `tabIndex={-1}` and ensure interactive elements within them (like close buttons) explicitly implement `focus-visible` utility classes for keyboard accessibility.
## 2026-05-13 - [NoteSelector Accessibility Improvements]
**Learning:** Grouping related slider inputs (like Velocity, Duration, Expression) in a complex custom modal component using `<fieldset>` with `sr-only` `<legend>` dramatically improves screen reader navigation and context without affecting the existing visual layout, as long as utility classes like `border-none p-0 m-0` are applied to the fieldset.
**Action:** Always wrap logical groups of parameter controls in `<fieldset>` tags with descriptive `<legend>` elements instead of generic `div` containers, especially in dense UI sections.
## 2026-05-25 - Toast Accessibility Close Button
**Learning:** The Toast component lacked a close button, making it hard to dismiss quickly for keyboard and screen reader users before the 3s timeout. Automated Playwright verification of transient Toasts is also brittle without global state hooks.
**Action:** Added an explicit close button with aria-label and title to Toasts, and set aria-live=polite on the alert. Will rely on unit tests and manual dev check for transient UI components instead of forcing brittle E2E flows.
## 2024-05-28 - Icon-Only Button ARIA Labels
**Learning:** Initial grep searches for missing `aria-label` attributes on `<button>` elements with `title` attributes were misleading due to JSX formatting (attributes spread across multiple lines). A thorough manual inspection confirmed that core components (PhonemePainter, VoiceEditor, LiveKeyboard, NoteSelector, BottomBar) already have robust `aria-label` implementations for their icon-only buttons.
**Action:** Always verify regex/grep results with manual file inspection when analyzing JSX for accessibility attributes. Avoid redundant work on this specific pattern in these components.
## 2026-06-01 - Added role='region' for aria-label on div
**Learning:** Screen readers typically ignore `aria-label` on generic block elements like `<div>` unless they are assigned a semantic role like `region` or `group`.
**Action:** Always pair `aria-label` with a corresponding `role="region"` (or similar structural role) when applying it to structural containers like `<div>` to ensure assistive technologies actually announce it.
## 2024-05-31 - Interactive SVG Element Accessibility
**Learning:** Data visualization components (like automation curves) often render interactive points as basic SVG `<circle>` or `<g>` tags relying solely on pointer events (`onMouseDown`). This completely excludes keyboard users from interacting with the data.
**Action:** When rendering interactive nodes inside SVGs, always add `tabIndex={0}`, `role="button"`, an informative `aria-label`, visible focus styling (e.g., `outline-none focus:stroke-cyan-200 focus:stroke-[2px]`), and an explicit `onKeyDown` handler that replicates the pointer drag functionality (using Arrow keys) and deletion (using Delete/Backspace).
## 2026-05-26 - Engine303Selector Keyboard Navigation and Screen Reader Labels
**Learning:** The Engine303Selector's engine toggle buttons only relied on plain text labels without explicit screen reader context, and lacked focus-visible states for keyboard navigation, making them difficult to use for non-mouse users.
**Action:** Added `focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2` to make keyboard focus visible, and explicit `aria-label`s ("Select Custom Open303 engine", "Select Authentic JC303 engine") to provide screen readers with better context on what the buttons do.
## 2026-06-02 - Consistent Focus Ring Styling
**Learning:** Found inconsistencies where some components used generic `focus:ring-2` while others used the more robust `focus-visible:ring-2 focus-visible:ring-offset-2`. Additionally, dark-themed UIs require `ring-offset-gray-900` or similar offset colors to make the focus ring visible against the background.
**Action:** Standardize interactive elements to use the full `focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[bg-color] focus-visible:ring-[accent-color]` pattern.
## 2024-06-16 - Focus Rings on Custom Modal Tab Elements
**Learning:** When building complex custom modals like `AISongModal` with multiple tabs or embedded action buttons (e.g. 'Fix JSON' or 'Copy Template'), developers often forget to add keyboard focus styling because they implement them as raw `<button>` elements with heavy custom CSS, assuming pointer-only interaction. This makes the modal practically unusable for keyboard-only users who cannot see which tab is active or which action is focused.
**Action:** Always ensure that every custom `<button>` element inside modals—particularly those functioning as tabs (`role="tab"`) or tertiary actions—has explicit `focus-visible:ring-2` utility classes to guarantee keyboard accessibility.
## 2026-06-18 - Missing Type Attribute on Buttons
**Learning:** Found several generic `<button>` elements lacking the `type="button"` attribute. In HTML, buttons inside or outside forms default to `type="submit"`, which can cause unintended side-effects like reloading the page when activated via keyboard.
**Action:** Always explicitly specify `type="button"` on non-submit buttons (e.g. toggle switches, close icons) to prevent unintended form submission behaviors and improve screen reader stability.
## 2026-06-29 - Fixed missing type='button' in NoteSelector and AutomationLaneList
**Learning:** Generic <button> elements inside heavy editing flows like NoteSelector and AutomationLaneList often omit the type="button" attribute. While they may not immediately sit inside a <form> element, it is standard HTML and accessibility practice to explicitly add type="button" to non-submit action buttons to ensure correct behavior and stability.
**Action:** Always explicitly specify type="button" on generic <button> elements, especially in high-use panels like NoteSelector and AutomationLaneList.
## 2026-07-08 - [Added type="button" to icon buttons]
**Learning:** Many interactive SVG/icon buttons lacked `type="button"`, which could accidentally submit forms.
**Action:** Add `type="button"` systematically to non-submit buttons to improve accessibility and prevent unintended navigation/submission.
## 2026-07-06 - Fixed missing type='button' in ProphecyPanel
**Learning:** Buttons in newly added panels (like ProphecyPanel) sometimes still omit the type="button" attribute. It is crucial to remember to apply it to all interactive UI components, especially ones generating dynamic lists like the Vowel labels.
**Action:** Always explicitly specify type="button" on generic <button> elements, even when mapped through arrays to prevent layout breakage or unwanted submissions during keyboard interaction.
## 2026-07-04 - Safely scripting widespread type="button" updates
**Learning:** Programmatically updating hundreds of missing `type="button"` attributes using regex scripts across a complex React codebase can easily cause duplicates, merge conflict errors, or mistakenly alter the AST if run against recently broken/refactored logic. React builds fail loudly on duplicate attributes (`TS17001`).
**Action:** When performing sweeping attribute additions, always check for pre-existing occurrences in the target line, avoid touching files currently showing unresolved merge errors, and test via `pnpm lint` and `pnpm build` immediately to catch syntax errors introduced by over-eager regex.

## 2026-07-10 - [Keyboard Accessibility for Playable Audio Triggers]
**Learning:** When adding keyboard navigation to components that trigger real-time audio (like `DrumPads.tsx`), standard `<button>` click handling is insufficient. The Spacebar key defaults to scrolling the page, and operating system key-repeat rapidly fires `onKeyDown` if the key is held, causing horrible audio stuttering.
**Action:** Always intercept `' '` (Space) and `'Enter'` keys explicitly via `onKeyDown` and `onKeyUp`. Call `e.preventDefault()` to stop scrolling, and maintain an active state (like a `Set` of active pad IDs) to ensure the audio trigger (`handlePadDown`) only fires once per physical key press, ignoring subsequent auto-repeat events.
## 2026-07-14 - SongMode accessibility roving tabindex
**Learning:** The ESLint/TypeScript parse error (e.g., `',' expected` or `Expression expected`) often reported around line 214 of `src/hooks/useAudioEngine.ts` is a known environmental false positive regarding valid destructuring (from `createSampleLibraryControls`). It shouldn't block unrelated scopes.
**Action:** Ignore it or note it in the PR description, and do not attempt to fix this syntax if it surfaces during unrelated feature work.
