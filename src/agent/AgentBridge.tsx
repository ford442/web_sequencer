/**
 * `window.__HYPHON_AGENT__` — the agent render hook.
 *
 * Mounted (lazily, see App.tsx) only with `?agent=1` or `?e2e=1`, so the public
 * build has no such global. `scripts/ai-song-render.ts` drives it through
 * Playwright: import an AI song, render it, read the bytes back. The API itself
 * is in `agentApi.ts`.
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import { useAppStateSelector, type AppState } from '../contexts/AppStateContext';
import { createAgentApi, createAgentStateHandle } from './agentApi';

const everything = (state: AppState) => state;

/** Registers the hook for as long as it is mounted. Renders nothing. */
export default function AgentBridge(): null {
    // Subscribing to all of the state re-renders this on every change, which
    // costs nothing here (it renders null) and keeps the API on the latest commit.
    const state = useAppStateSelector(everything);
    const [handle] = useState(() => createAgentStateHandle(state));
    useLayoutEffect(() => handle.publish(state), [handle, state]);
    useEffect(() => {
        const api = createAgentApi(handle);
        window.__HYPHON_AGENT__ = api;
        return () => {
            if (window.__HYPHON_AGENT__ === api) delete window.__HYPHON_AGENT__;
        };
    }, [handle]);
    return null;
}
