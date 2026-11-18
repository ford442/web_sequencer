/**
 * The live pattern (#1597 P2): the 32-step grid every track plays from.
 *
 * Used to be a `useState` inside `useAppState()`, with `patternRef` synced in
 * an effect after each commit. As an external store its writes are
 * synchronous — `patternRef.current` is the new pattern the moment
 * `setPattern` returns — which is what lets the project doc binding attribute
 * each write to the editor making it and read peers' edits back in without
 * waiting for React.
 */

import type { Pattern } from '../types';
import { UPDATED_INITIAL_PATTERN } from '../constants/appDefaults';
import { createValueStore, useValueStore } from './valueStore';

export const patternStore = createValueStore<Pattern>(UPDATED_INITIAL_PATTERN);

export function usePatternStore(): Pattern {
    return useValueStore(patternStore);
}
