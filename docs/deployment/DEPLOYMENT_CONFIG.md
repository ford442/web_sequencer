# **DEPLOYMENT\_CONFIG.md**

# Deployment Configuration & Constraints

**Critical: Static Hosting Path**

This project is statically hosted at the subdirectory \`/hyphon/\` (e.g., \`\[suspicious link removed\]\`).

## **Rules for Development**

1\. Vite Configuration

The \`base\` path in \`[vite.config.ts](http://vite.config.ts)\` must always remain set to relative (\`./\`) or explicitly \`/hyphon/\` to ensure assets load correctly in the subdirectory.

\`\`\`

// [vite.config.ts](http://vite.config.ts)

export default defineConfig({

  base: './', // DO NOT CHANGE to '/'

  // ...

});

\`\`\`

2\. Asset & Worker Loading

Never use absolute paths (e.g., \`/file.wasm\`) for fetching resources, initializing Workers, or loading audio files. You **MUST** use \`import.meta.env.BASE\_URL\` to prepend the correct base path.

**Correct Patterns:**

\`\`\`

// Fetching WASM/JSON

fetch(import.meta.env.BASE\_URL \+ 'rubberband.wasm');

// Initializing Workers

new Worker(import.meta.env.BASE\_URL \+ 'hyphon\_native.js');

// Audio URLs

const audioUrl \= import.meta.env.BASE\_URL \+ 'presets/saw.wav';

\`\`\`

**Incorrect Patterns (Will Cause 404s):**

\`\`\`

fetch('/rubberband.wasm'); // Fails at /hyphon/

new Worker('/hyphon\_native.js'); // Fails

\`\`\`

3\. AudioWorklets & DSP

AudioWorklets cannot access \`import.meta.env\` directly. Pass the \`wasmBinary\` or resolved URLs from the main thread via \`postMessage\` during initialization.

\---

*Keep this configuration active indefinitely.*