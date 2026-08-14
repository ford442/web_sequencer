## 2024-05-24 - PhonemePainter Empty State Standardization
**Learning:** This app uses a very specific standardized empty state pattern (`border-dashed`, circular icon backgrounds) that is heavily duplicated inline rather than extracted to a reusable component. Missing this pattern in new views (like PhonemePainter) makes the UI feel inconsistent.
**Action:** When adding new list or timeline views, always verify against existing empty states (e.g. `CloudLibrary`, `MidiMapPanel`) to manually copy the standardized class structure until a shared `EmptyState` component is built.
