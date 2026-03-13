# Switchboard

Electron desktop app for browsing, searching, and managing CLI coding sessions.

## Stack

- Electron + electron-vite + TypeScript
- Renderer: vanilla TS (no framework), CodeMirror, xterm.js, morphdom
- Main: better-sqlite3, node-pty, express, ws
- Linting: Biome (strict config in biome.json)
- Package manager: pnpm

## Project structure

```
src/main/          — Electron main process (db, pty, IPC, scanning, auto-updater)
src/main/workers/  — Worker threads (scan-projects)
src/preload/       — Preload bridge
src/renderer/src/  — UI (app, sidebar, viewers, terminal, state, themes)
build/             — Electron-builder resources (icons, entitlements)
```

## Commands

```sh
pnpm dev           # Run in dev mode
pnpm build         # Build renderer + main
pnpm package       # Build + package for current platform
pnpm lint          # Biome check (format + lint + assist)
pnpm typecheck     # tsc --noEmit
```

## Code conventions

- Biome enforces strict rules — run `pnpm lint` before committing
- No `any`, no `console.*` (use electron-log), no `var`, no `==`
- Explicit return types on functions (`useExplicitType`)
- No barrel files, no re-export-all, no namespace imports
- No import cycles
