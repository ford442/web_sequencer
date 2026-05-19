# Root Documentation Index

This file indexes all Markdown documents at the repository root for quick discovery and agent context lookup. For detailed subsystem documentation organized by topic, see [`docs/README.md`](docs/README.md).

---

## Core Reference

These are the primary documents for understanding the project and contributing to it.

| File | Purpose |
|------|---------|
| [README.md](README.md) | Project overview, feature list, quick-start commands, and links to TTS model setup |
| [AGENTS.md](AGENTS.md) | Comprehensive guide for AI agents (Jules, Copilot, Claude) with architecture, conventions, and build/test commands |
| [claude.md](claude.md) | Claude-specific development guide with tech stack, codebase structure, and debugging tips |
| [agent_plan.md](agent_plan.md) | Living roadmap and backlog tracking with prioritized features across all domains |
| [weekly_plan.md](weekly_plan.md) | Active weekly planning document with current focus, ideas, and completed tasks |

---

## AI Agent & Tool Guidance

Specialized context for different AI assistants and tools working in this repository.

| File | Purpose |
|------|---------|
| [grok.md](grok.md) | Grok AI assistant guide covering sound quality, usability, and creative feature priorities |

---

## Active Working Documents

Temporary or in-progress planning documents for current development sprints.

| File | Purpose |
|------|---------|
| [lfo_sync_plan.md](lfo_sync_plan.md) | Planning notes for LFO synchronization feature implementation |
| [plan.md](plan.md) | Distortion and effect tuning notes for audio engine refinement |
| [plan2.md](plan2.md) | Formant envelope implementation planning and parameter notes |
| [test_plan.md](test_plan.md) | Test strategy for formant shifting and vocal filter effects |
| [test_plan2.md](test_plan2.md) | Extended testing notes for formant envelope attack/decay behavior |

---

## Subsystem Documentation

For detailed documentation organized by feature area (audio engine, WASM, UI, TTS, deployment, refactoring, and archive), see:

- **[docs/README.md](docs/README.md)** — Full index of subsystem docs

The `docs/` directory contains:
- `audio-engine/` — Harmonizer, Multisample, Rubberband, JC-303, Open303 docs
- `ui/` — Holographic knobs, keyboard input, progress bar designs
- `tts/` — Voice synthesis deployment, implementation, and verification guides
- `wasm/` — WASM build notes and configuration
- `deployment/` — Cloud API and SFTP deployment docs
- `refactoring/` — App refactoring, performance migration, architecture notes
- `archive/` — Historical implementation records and completed features

---

## Session & Build Records

Automated records from development sessions and build automation.

| File | Purpose |
|------|---------|
| [.swarm-state.md](.swarm-state.md) | Swarm automation iteration log tracking changes and build status |
| copilot-session-*.md | Individual Copilot session transcripts (session-specific) |

---

## Quick Links

- **For new contributors:** Start with [README.md](README.md), then [AGENTS.md](AGENTS.md)
- **For Claude/Copilot agents:** See [claude.md](claude.md) and [AGENTS.md](AGENTS.md)
- **For audio subsystem docs:** See [docs/audio-engine/](docs/audio-engine/)
- **For UI/UX docs:** See [docs/ui/](docs/ui/)
- **For TTS docs:** See [docs/tts/](docs/tts/)
- **For build/deployment:** See [docs/deployment/](docs/deployment/)
- **For architecture:** See [docs/DEVELOPER_CONTEXT.md](docs/DEVELOPER_CONTEXT.md)

---

## Build & Test Commands

Quick reference (detailed in [AGENTS.md](AGENTS.md)):

```bash
# Development
npm install
npm run dev          # Start dev server with WASM builds

# Build & Deploy
npm run build        # Full production build
npm run preview      # Preview production build

# Testing & Linting
npm test            # Run Vitest tests
npm run lint        # Run ESLint
npx tsc -b          # TypeScript check

# Deployment
npm run deploy      # Deploy dist/ to remote server
```

---

## Notes for Agents

- **Context lookup:** This file (`DOCS.md`) is the entry point. Use it to locate relevant documentation in `docs/` or root-level context files.
- **File organization:** Root files are active projects and reference docs. Topic-specific details live in `docs/` subdirectories.
- **Phase 2 migration:** Physical migration of root `*.md` files into `docs/` structure is deferred; Phase 1 (this index) resolves discoverability without breaking external links.
