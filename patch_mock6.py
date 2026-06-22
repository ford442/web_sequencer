import json

with open('package.json', 'r') as f:
    pkg = json.load(f)

# revert vite and vitest versions to whatever they were before pnpm test ran and failed
