---
project: port-scanner
health: green
last-updated: 2026-06-28 00:00 UTC
---

# port-scanner — Status

## Current Status

Active macOS Tauri 2 desktop app for scanning TCP listeners, inspecting processes, checking basic system resources, exporting filtered data, opening local services, and killing known scanned PIDs.

## What's Working

- Ports view scans `lsof` TCP listeners and enriches rows with command, cwd/project, uptime, bind address, copy/open/kill actions, and optional admin scan.
- Processes view lists running processes with command, uptime, project folder, listener addresses, copy, and kill actions.
- System view loads memory/disk metrics first, then fills process/listener counts from the parallel process scan.
- Toolbar remains available even when a scan returns no rows, so users can always switch views, refresh, filter, and export.
- Settings persist locally with best-effort localStorage writes and safe fallback defaults.
- Quality gate is codified in `npm run check` and `.gg/commands/commit.md`.

## What's Blocked

- Nothing currently.

## What's Next

- Add signed/notarized release distribution when Apple Developer credentials are available.
- Add end-to-end UI coverage if the app grows beyond the current local utility scope.
- Add Windows/Linux backend implementations only if cross-platform support becomes a product goal.

## Last Session

**What happened:** Audited project-wide app code, backend parser coverage, docs, CI, and command automation; fixed empty-state navigation, System CSV export, settings persistence safety, Rust toolchain pinning, CI Rust gates, and docs/status drift.
**Local path:** `/Users/dellcbyerllc/projects/port-scanner`
