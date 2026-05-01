## 2024-05-01 - Fix aria-controls for Harmonizer Popover
**Learning:** Found that custom dropdowns/popovers acting as modals or flyouts require a clear structural link using `aria-controls` pointing to the exact `id` of the popover content. The `aria-expanded` and `aria-haspopup` tags alone are insufficient for complete screen reader accessibility if the container it targets cannot be identified via an `id` reference.
**Action:** Always ensure that `aria-controls` matches a specific `id` attribute on the container component whenever implementing custom popup interfaces.
