/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        hyphon: {
          deep: 'var(--hyphon-bg-deep)',
          chassis: 'var(--hyphon-bg-chassis)',
          panel: 'var(--hyphon-bg-panel)',
          surface: 'var(--hyphon-bg-surface)',
          inset: 'var(--hyphon-bg-inset)',
          raised: 'var(--hyphon-bg-raised)',
        },
      },
      fontFamily: {
        orbitron: ['var(--hyphon-font-display)'],
        mono: ['var(--hyphon-font-data)'],
      },
      boxShadow: {
        'hyphon-panel': 'var(--hyphon-shadow-panel)',
        'hyphon-toolbar': 'var(--hyphon-shadow-toolbar)',
        'hyphon-glow-cyan': 'var(--hyphon-shadow-glow-cyan)',
      },
      borderRadius: {
        hyphon: 'var(--hyphon-radius-lg)',
      },
    },
  },
  plugins: [],
}
