/**
 * Starter packs that ship as `.hyphonpack.json` data files, not as code.
 *
 * Each file is its own lazily loaded chunk (a JSON module, which the bundler
 * ships minified) and goes through the same importer a user's file does, so the starters double as the format's
 * reference examples. Add one by dropping the file in `./library/` and listing
 * it here; `sessionPackLibrary.test.ts` fails if the list and the folder
 * disagree, or if any file is not a valid pack.
 */

export interface LibraryPackEntry {
  /** Must equal the file's `id`. */
  id: string;
  /** Must equal the file's `name`; shown on the launcher button before the file is loaded. */
  name: string;
  /** Must equal the file's `description`; the button's tooltip. */
  description: string;
  /** The parsed file, still to be validated: it goes through `parseSessionPackValue` like any import. */
  load: () => Promise<unknown>;
}

export const LIBRARY_PACKS: readonly LibraryPackEntry[] = [
  {
    id: 'ambient-drift',
    name: 'Ambient Drift',
    description: 'Evolving two-bar chord movements that follow each other on their own, with bells that wander between clips at random. Launch a scene, then let the follow actions play. Works well around 70–90 BPM.',
    load: async () => (await import('./library/ambient-drift.hyphonpack.json')).default,
  },
  {
    id: 'broken-beat-workbench',
    name: 'Broken Beat Workbench',
    description: 'Syncopated kick and snare cells over funk-groove hats, with FM electric-piano stabs and a gliding FM bass. Five scenes from intro to a one-shot fill. Sits at 110–120 BPM.',
    load: async () => (await import('./library/broken-beat-workbench.hyphonpack.json')).default,
  },
  {
    id: 'vocal-sampler-booth',
    name: 'Vocal Sampler Booth',
    description: 'Sampler clips for performing a voice: a phrase, call and reply across two banks, a sliced chop roll, a reversed swell and a held stutter. Load your own vocal into sampler banks 1–4 first; the pack carries patterns, not audio.',
    load: async () => (await import('./library/vocal-sampler-booth.hyphonpack.json')).default,
  },
];
