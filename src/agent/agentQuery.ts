/**
 * The agent render hook (`window.__HYPHON_AGENT__`) is registered only with one
 * of these query flags, so the public build carries no such surface. Kept apart
 * from the hook so App.tsx can check it without pulling the hook into the entry
 * chunk.
 */
export const AGENT_QUERY_FLAGS = ['agent', 'e2e'] as const;

export function isAgentQuery(search: string): boolean {
    const params = new URLSearchParams(search);
    return AGENT_QUERY_FLAGS.some((flag) => params.has(flag));
}
