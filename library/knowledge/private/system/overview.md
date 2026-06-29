# Port Scanner System Overview

## Purpose

Port Scanner is a lightweight macOS desktop app for local development and troubleshooting. It helps a user see what is listening on TCP ports, inspect running processes, view basic system resource metrics, open localhost services, export visible data, and kill known scanned processes when a clean slate is needed.

## Platform and product scope

Port Scanner is intentionally macOS-focused.

- Supported: macOS 11 Big Sur and newer, Apple Silicon and Intel Macs.
- Not supported: Windows. The backend depends on macOS tools and commands including `lsof`, `osascript`, `/bin/kill`, `open`, `ps`, `sysctl`, `vm_stat`, and `df`.
- Distribution target: a real `.app` bundle built by Tauri, with GitHub Release zip artifacts for sharing.
- Current release version: `0.1.0` from `package.json` and `src-tauri/tauri.conf.json`.
- License: GPL-3.0.

## Technology stack

- Desktop shell: Tauri 2.
- Frontend: Vite, React 19, TypeScript.
- Backend: Rust Tauri commands.
- Browser/system API usage: localStorage, Clipboard API, geolocation, fetch, Blob downloads.
- CI/CD: GitHub Actions on `macos-14` with Node 22 and the pinned Rust toolchain.

## Runtime architecture

```mermaid
flowchart LR
  User[User] --> UI[React UI in Tauri WebView]
  UI -->|invoke| Tauri[Tauri command bridge]
  Tauri --> Rust[Rust backend]
  Rust --> LSOF[lsof]
  Rust --> PS[ps]
  Rust --> SYS[sysctl / vm_stat / df]
  Rust --> OPEN[open]
  Rust --> KILL[/bin/kill -9]
  Rust --> OSASCRIPT[osascript admin lsof]
  UI --> LS[localStorage preferences]
  UI --> CLIP[Clipboard API]
  UI --> GEO[Geolocation API]
  UI --> WEATHER[open-meteo / ipapi.co]
```

The React app owns presentation, filtering, sorting, export formatting, settings, kill confirmation UI, and auto-refresh. The Rust backend owns process discovery, system metrics, URL launching, and PID termination.

## Key capabilities

- Ports view: TCP listeners from `lsof -n -P -iTCP -sTCP:LISTEN`, enriched with process command, uptime, cwd, project folder, bind address, copy/open/kill actions, and optional admin scan.
- Processes view: running process list from `ps -axww -o pid=,etime=,command=`, enriched with selected cwd values and listener addresses.
- System view: memory and disk metrics plus process/listener counts filled from a parallel process scan.
- Dashboard: status chips, active mode, health, auto-refresh state, counts, uptime summaries, memory/disk summaries, and optional local weather.
- Export: CSV and JSON for the currently filtered view.
- Settings: open scheme, open path, skip kill confirmation, auto-refresh interval, and protected listener keys.
- Safety controls: kill confirmation by default, per-listener protection, and backend allowlist requiring a PID to come from the latest scan.

## Source map

- `README.md` — user-facing project overview, installation, release, feature, CI, and contribution documentation.
- `STATUS.md` — current project health, working features, next steps, and last-session summary.
- `package.json` — Node scripts, dependencies, project metadata, GPL-3.0 license, and repository URL.
- `src/main.tsx` — React entrypoint rendering `<App />` under `React.StrictMode`.
- `src/App.tsx` — main frontend application: state, Tauri invocations, views, filtering, sorting, export, weather, settings, kill UI, and rendering.
- `src/prefs.ts` — localStorage settings schema and safe load/save helpers.
- `src/App.css` — cockpit-themed UI tokens, layout, responsive behavior, tables, MFD panels, modals, toasts, and controls.
- `src-tauri/src/main.rs` — Tauri binary entrypoint that calls `kill_ports_lib::run()`.
- `src-tauri/src/lib.rs` — Rust command implementation, parser/enrichment helpers, system metric helpers, allowlisted kill command, and unit tests.
- `src-tauri/tauri.conf.json` — Tauri app metadata, window config, frontend build config, and `.app` bundle target.
- `.github/workflows/build-macos.yml` — push/PR/workflow-dispatch macOS build and artifact workflow.
- `.github/workflows/release-macos.yml` — tag-triggered macOS release zip and GitHub Release workflow.

## Current status

`STATUS.md` marks the project health as green as of 2026-06-28. Nothing is currently blocked. Next likely work includes signed/notarized distribution, end-to-end UI coverage if the app grows, and possible alternate backend implementations only if Windows/Linux become a product goal.

## Generated/local wiki note

`library/knowledge-base/wiki/` is generated/local and currently ignored. Tracked documentation for this repository belongs in schema v2 paths under `library/knowledge/` and `library/requirements/reports/`.
