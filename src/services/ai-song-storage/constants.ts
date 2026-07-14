/** Default folder for AI-generated songs */
export const AI_SONGS_FOLDER = 'ai-generated';

/** Known AI generator identifiers */
export const AI_GENERATORS = [
  'claude',
  'claude-3-opus',
  'claude-3-sonnet',
  'gemini',
  'gemini-pro',
  'jules',
  'copilot',
  'gpt-4',
  'gpt-3.5',
  'unknown'
] as const;

export type AIGenerator = typeof AI_GENERATORS[number];

/** Auto-folder structure */
export const AI_FOLDERS = {
  ROOT: 'ai-generated',
  CLAUDE: 'ai-generated/claude',
  GEMINI: 'ai-generated/gemini',
  JULES: 'ai-generated/jules',
  COPILOT: 'ai-generated/copilot',
  OTHER: 'ai-generated/other'
} as const;

/** Retry configuration */
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 4,
  DELAYS: [0, 1000, 2000, 4000], // Immediate, 1s, 2s, 4s
  JITTER_PERCENT: 0.3,
  CIRCUIT_BREAKER_THRESHOLD: 3,
  CIRCUIT_BREAKER_RESET_MS: 30000
};

/** IndexedDB configuration */
export const DB_CONFIG = {
  NAME: 'AISongStorage',
  VERSION: 1,
  STORES: {
    PENDING_UPLOADS: 'pendingUploads',
    SONG_ERRORS: 'songErrors',
    VERSION_HISTORY: 'versionHistory'
  }
};
