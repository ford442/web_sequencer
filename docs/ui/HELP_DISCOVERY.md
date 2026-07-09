# In-app Help & Discovery

> Addresses discoverability tracking [#632](https://github.com/ford442/web_sequencer/issues/632), [#633](https://github.com/ford442/web_sequencer/issues/633), [#634](https://github.com/ford442/web_sequencer/issues/634).

## Opening help

| Method | Action |
|--------|--------|
| Keyboard | Press `?` (when not typing in a field) |
| Bottom bar | Click `?` Help button |
| Contextual | Click `?` icons on engine panels, sampler, transport |
| What's New | Click any checklist item in the dismissible banner |

## Modal tabs

1. **Search** — fuzzy match across titles, summaries, keywords, and categories
2. **Guides** — full topic cards with step-by-step workflow thumbnails
3. **Shortcuts** — keyboard and MIDI reference (legacy ShortcutsHelp content)

## Contextual components

| Component | Path | Topic ids |
|-----------|------|-----------|
| `HelpTip` | `src/components/help/HelpTip.tsx` | Hover/focus tooltip + optional first-use pin |
| `HelpIconButton` | same | Opens guide for a topic |
| `WhatsNewBanner` | `src/components/help/WhatsNewBanner.tsx` | Checklist of major workflows |

## Topic catalog

All topics live in `src/content/helpTopics.ts`. Add new entries when shipping features:

```ts
{
  id: 'my-feature',
  title: 'Short title',
  summary: 'One-line answer for search',
  body: 'Paragraphs separated by \\n\\n',
  keywords: ['search', 'terms'],
  category: 'engine',
  steps: ['Step 1', 'Step 2'],
  docLink: 'docs/...',
}
```

Bump `HELP_WHATS_NEW_VERSION` in the same file to re-show the banner.

## Persistence

`src/stores/helpDiscoveryStore.ts` (localStorage key `hyphon-help-discovery`):

- `seenTipIds` — first-use tips dismissed
- `whatsNewDismissedVersion` — banner dismiss per release

## Accessibility

- Tooltips use `role="tooltip"` + `aria-describedby`
- Help modal uses focus trap (`useFocusTrap`)
- Animations gated with `motion-safe:` / `prefers-reduced-motion` in CSS
- All `?` buttons have explicit `aria-label`

## Example queries

| User question | Search query |
|---------------|--------------|
| How do I automate a filter? | `automate filter` |
| Switch to authentic 303? | `jc303` or `authentic 303` |
| Prophecy vowels? | `prophecy formant` |
| Record knob movement? | `rec auto` |
| Import ReBirth? | `rbs` |
| Sampler speech? | `tts` |
