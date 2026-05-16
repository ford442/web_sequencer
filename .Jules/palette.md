## 2026-05-15 - Decorative Icons Need Explicit Aria Hiding
**Learning:** Even when a button has a descriptive `aria-label`, decorative text elements inside it (like the `⌨` emoji inside a `<span>`) can still be read awkwardly by some screen readers if not explicitly hidden.
**Action:** When adding an `aria-label` to a button containing a decorative text icon, always remember to add `aria-hidden="true"` directly to the decorative element itself to ensure a clean auditory experience.
